import morgan from 'morgan';

const logger = morgan('combined');
export default fromNodeMiddleware((req, res, context) => logger(req, res, context));