require('dotenv').config();

const { Kafka, logLevel } = require('kafkajs');

const KAFKA_TOPIC = 'new-mention';

async function getKafkaClient() {
    return new Kafka({
        clientId: 'mention-matcher',
        brokers: [process.env.KAFKA_BROKER],
        logLevel: logLevel.DEBUG,
        retry: {
            initialRetryTime: 5000,
            maxRetryTime: 10000,
            retries: 10,
        },
    });
}

class MentionMatcher {
    async start() {
        this.kafkaClient = await getKafkaClient();
        this.kafkaConsumer = this.kafkaClient.consumer({
            groupId: 'mention-matcher',
        });

        await this.kafkaConsumer.connect();
        await this.kafkaConsumer.subscribe({
            topic: KAFKA_TOPIC,
            fromBeginning: true,
        });

        this.kafkaConsumer.run({
            eachMessage: this.handleMessage,
        });
    }

    async stop() {
        console.log('Stopping...');
        await this.kafkaConsumer.disconnect();
    }

    handleMessage() {
        console.log(...arguments);
    }
}

const mentionMatcher = new MentionMatcher();
mentionMatcher.start();

const signalTraps = ['SIGTERM', 'SIGINT', 'SIGUSR2'];
signalTraps.map((type) =>
    process.once(type, async () => mentionMatcher.stop())
);
