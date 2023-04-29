import azure from "@azure/storage-queue";

declare namespace Consumer {
    export type ConsumerDone = (error?: Error) => void;

    export interface Options {
        queueName: string;
        handleMessage(message: azure.QueueClient.Message, done: ConsumerDone): any;
        batchSize?: number;
        waitTimeSeconds?: number;
        authenticationErrorTimeout?: number;
        queueService?: azure.QueueClient;
        autoBind: autoBind
    }
}

declare class Consumer extends NodeJS.EventEmitter {
    constructor(options: Consumer.Options);
    start(): void;
    stop(): void;
    static create(options: Consumer.Options): Consumer;
}

export = Consumer;