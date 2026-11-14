import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EventPublisher } from "../application/contracts";
import { ExecutionEvent } from "../application/messaging";

@Injectable()
export class SnsEventPublisher implements EventPublisher {
  private readonly topicArn: string;

  constructor(
    private readonly client: SNSClient,
    config: ConfigService,
  ) {
    this.topicArn = config.getOrThrow<string>("SNS_TOPIC_ARN");
  }

  async publish(event: ExecutionEvent): Promise<void> {
    await this.client.send(
      new PublishCommand({
        TopicArn: this.topicArn,
        Message: JSON.stringify(event),
        MessageAttributes: {
          eventType: {
            DataType: "String",
            StringValue: event.messageType,
          },
          correlationId: {
            DataType: "String",
            StringValue: event.correlationId,
          },
          messageId: {
            DataType: "String",
            StringValue: event.messageId,
          },
          ...(event.sagaId
            ? {
                sagaId: {
                  DataType: "String",
                  StringValue: event.sagaId,
                },
              }
            : {}),
          aggregateId: {
            DataType: "String",
            StringValue: event.aggregateId,
          },
        },
      }),
    );
  }
}
