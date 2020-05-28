require('dotenv').config();

const Twitter = require('twitter-lite');
const { Kafka, logLevel } = require('kafkajs');

const KAFKA_TOPIC = 'new-mention';
const SUPPPORTED_LANGUAGES = ['en', 'de'];

async function getTwitterClient() {
    const user = new Twitter({
        consumer_key: process.env.CONSUMER_KEY,
        consumer_secret: process.env.CONSUMER_SECRET,
        access_token_key: process.env.ACCESS_TOKEN_KEY,
        access_token_secret: process.env.ACCESS_TOKEN_SECRET,
    });

    try {
        await user.get('account/verify_credentials');
    } catch (error) {
        console.log(error);
    }
    return user;
}

async function getKafkaClient() {
    return new Kafka({
        clientId: 'twitter-crawler',
        brokers: [process.env.KAFKA_BROKER],
        logLevel: logLevel.DEBUG,
        retry: {
            initialRetryTime: 5000,
            maxRetryTime: 10000,
            retries: 10,
        },
    });
}

class TwitterCrawler {
    async start() {
        console.log('process.env', process.env);
        this.twitterClient = await getTwitterClient();
        this.kafkaClient = await getKafkaClient();
        this.kafkaProducer = await this.kafkaClient.producer();

        await this.kafkaProducer.connect();

        this.crawl();
    }

    async stop() {
        console.log('Stopping...');
        await this.kafkaProducer.disconnect();
        await this.mentionStream.destroy();
    }

    async crawl() {
        this.mentionStream = this.twitterClient
            .stream('statuses/sample')
            .on('start', () => console.log('Start twitter sample stream'))
            .on('data', (tweet) => this.handleTweet(tweet))
            .on('error', (error) => console.log('error', error))
            .on('end', () => console.log('Start twitter sample stream'));
    }

    handleTweet(tweet) {
        const parsedTweet = this.parseTweet(tweet);

        if (parsedTweet) {
            console.log('Add to topic', KAFKA_TOPIC, parsedTweet);
            this.kafkaProducer.send({
                topic: KAFKA_TOPIC,
                messages: [{ value: JSON.stringify(parsedTweet) }],
            });
        }
    }

    parseTweet(tweet) {
        if (!tweet.text) {
            return;
        }

        if (!SUPPPORTED_LANGUAGES.includes(tweet.lang)) {
            return;
        }

        const text = tweet.truncated
            ? tweet.extended_tweet.full_text
            : tweet.text;

        const parsedTweet = {
            text,
            lang: tweet.lang,
            handle: tweet.user.screen_name,
            date: tweet.created_at,
        };

        return parsedTweet;
    }
}

const crawler = new TwitterCrawler();
crawler.start();

const signalTraps = ['SIGTERM', 'SIGINT', 'SIGUSR2'];
signalTraps.map((type) => process.once(type, async () => crawler.stop()));
