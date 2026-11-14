import * as Joi from 'joi';

export const envSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().port().default(3000),
  AWS_REGION: Joi.string().required(),
  AWS_ENDPOINT_URL: Joi.string().uri().optional().allow(''),
  DYNAMODB_TABLE: Joi.string().required(),
  SQS_QUEUE_URL: Joi.string().uri().required(),
  SNS_TOPIC_ARN: Joi.string()
    .pattern(/^arn:aws[a-z-]*:sns:[a-z0-9-]+:\d{12}:.+$/)
    .required(),
  SQS_WAIT_TIME_SECONDS: Joi.number().integer().min(1).max(20).default(20),
  SQS_VISIBILITY_TIMEOUT: Joi.number().integer().min(1).default(60),
  SWAGGER_ENABLED: Joi.string().valid('true', 'false').default('true'),
});
