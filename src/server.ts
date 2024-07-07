import http from 'http';

import { IAuthPayload, IErrorResponse, winstonLogger } from '@k0msak007/jobber-shared';
import { Logger } from 'winston';
import { config } from '@gig/config';
import { Application, json, NextFunction, Request, Response, urlencoded } from 'express';
import hpp from 'hpp';
import helmet from 'helmet';
import cors from 'cors';
import { verify } from 'jsonwebtoken';
import compression from 'compression';
import { appRoutes } from '@gig/routes';
import { checkConnection, createIndex } from '@gig/elasticsearch';
import { Channel } from 'amqplib';
import { createConnection } from '@gig/queues/connection';

import { consumeGigDirectMessage, consumeSeedDirectMessages } from './queues/gig.consumer';

const SERVER_PORT = 4004;
const log: Logger = winstonLogger(`${config.ELASTIC_SEARCH_URL}`, 'usersServer', 'debug');
let gigChannel: Channel;

const start = (app: Application): void => {
  securityMiddleware(app);
  standardMiddleware(app);
  routesMiddleware(app);
  startQueues();
  startElasticSearch();
  gigErrorHandler(app);
  startServer(app);
};

function securityMiddleware(app: Application): void {
  app.set('trust proxy', 1);
  app.use(hpp());
  app.use(helmet());
  app.use(
    cors({
      origin: config.API_GATEWAY_URL,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
    })
  );
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (req.headers.authorization) {
      const token = req.headers.authorization.split(' ')[1];
      const payload: IAuthPayload = verify(token, config.JWT_TOKEN!) as IAuthPayload;
      req.currentUser = payload;
    }
    next();
  });
}

function standardMiddleware(app: Application): void {
  app.use(compression());
  app.use(json({ limit: '200mb' }));
  app.use(urlencoded({ extended: true, limit: '200mb' }));
}

function routesMiddleware(app: Application): void {
  appRoutes(app);
}

async function startQueues(): Promise<void> {
  gigChannel = await createConnection() as Channel;
  await consumeGigDirectMessage(gigChannel);
  await consumeSeedDirectMessages(gigChannel);
}

function startElasticSearch(): void {
  checkConnection();
  createIndex('gigs');
}

function gigErrorHandler(app: Application): void {
  app.use((error: IErrorResponse, _req: Request, res: Response, next: NextFunction) => {
    log.log('error', `GigService ${error.comingFrom}:`, error);
    if (error.statusCode && error.comingFrom) {
      return res.status(error.statusCode).json({
        message: error.message,
        statusCode: error.statusCode,
        status: error.status,
        comingFrom: error.comingFrom
      });
    }
    next();
  });
}

function startServer(app: Application): void {
  try {
    const httpServer: http.Server = new http.Server(app);
    log.info(`Gig server has started with process id ${process.pid}`);
    httpServer.listen(SERVER_PORT, () => {
      log.info(`Gig server running on port ${SERVER_PORT}`);
    });
  } catch (error) {
    log.log('error', 'GigService startServer() method error:', error);
  }
}

export { start, gigChannel };
