require('dotenv').config();

const { Kafka } = require('kafkajs');
const solr = require('solr-client');

const util = require('util');

const KAFKA_TOPIC = 'new-mention';

const TEST_QUERIES = [
    {
        id: 1,
        searchString: 'ipad',
        name: 'iPad',
    },
    {
        id: 2,
        searchString: 'iphone',
        name: 'iPhone',
    },
];

async function getKafkaClient() {
    return new Kafka({
        clientId: 'mention-matcher',
        brokers: [process.env.KAFKA_BROKER],
        retry: {
            initialRetryTime: 5000,
            maxRetryTime: 10000,
            retries: 10,
        },
    });
}

class MentionMatcher {
    constructor() {
        this.queue = [];
        this.processQueue = this.processQueue.bind(this);
        this.handleMessage = this.handleMessage.bind(this);
    }

    async start() {
        this.solrClient = solr.createClient({
            host: 'localhost',
            port: '8983',
            path: '/solr',
            core: 'resources',
        });

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

        this.processQueue();
    }

    async stop() {
        console.log('Stopping...');

        await this.kafkaConsumer.disconnect();
        clearTimeout(this.processQueueTimer);
    }

    handleMessage({ message }) {
        const resource = JSON.parse(message.value.toString());
        this.queue.push(resource);
    }

    async processQueue() {
        await this.storeQueue();
        const allQueriesPromise = TEST_QUERIES.map(async (queryObject) => {
            const matches = await this.getMatches(queryObject);
            return {
                query: queryObject,
                resources: matches,
            };
        });

        const allQueries = await Promise.all(allQueriesPromise);
        console.log(util.inspect(allQueries, false, null, true));

        console.log('queue processed');
        this.processQueueTimer = setTimeout(() => this.processQueue(), 5000);
    }

    async getMatches(queryObject) {
        const query = this.solrClient
            .createQuery()
            .q({ text: queryObject.searchString })
            .start(0);

        return new Promise((resolve, reject) => {
            this.solrClient.search(query, (err, { response }) => {
                if (err) {
                    reject(err);
                }
                resolve(response.docs);
            });
        });
    }

    storeQueue() {
        const docs = this.queue.slice();
        this.queue = [];

        console.log(`Adding ${docs.length} documents`);

        return new Promise((resolve, reject) => {
            this.solrClient.add(docs, (err) => {
                if (err) {
                    reject(err);
                }

                this.solrClient.commit((err) => {
                    if (err) {
                        reject(err);
                    }

                    resolve();
                });
            });
        });
    }
}

const mentionMatcher = new MentionMatcher();
mentionMatcher.start();

const signalTraps = ['SIGTERM', 'SIGINT', 'SIGUSR2'];
signalTraps.map((type) =>
    process.once(type, async () => mentionMatcher.stop())
);
