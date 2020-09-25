import express from "express";
import http from "http";
import path from "path";
import { Kafka, KafkaMessage, ResourceTypes, DescribeConfigResponse, Consumer } from "kafkajs";
import { SchemaRegistry } from '@ovotech/avro-kafkajs';
import { Type } from "avsc";
import { v4 as uuidv4 } from 'uuid';
import { KAFKA_URLS, SCHEMA_REGISTRY_URL } from "./config";

type MessageInfo = { topic: string, partition: number, value: string, key: string, message: KafkaMessage, schemaType: Type | undefined }

type MessagesResult = { messages: MessageInfo[], hasTimeout: boolean }

type TopicQueryInput = { topic: string, partition: number, limit: number, offset: number, search: string, timeout?: number}

const schemaRegistry = new SchemaRegistry({ uri: SCHEMA_REGISTRY_URL });
const kafka = new Kafka({
	clientId: 'krowser',
	brokers: KAFKA_URLS
})

const admin = kafka.admin()

const app = express();

app.set("view engine", "ejs");
app.set("views", "public");

console.log(__dirname)
app.use("/assets", express.static(path.join(__dirname, "../client")));

app.get("/api/topics", async (req, res) => {
	try {
		const topics = await admin.fetchTopicMetadata(undefined as any)
		res.status(200).json(topics)
	}
	catch (error) {
		res.status(500).json({ error })
	}
})

app.get("/api/topic/:topic", async (req, res) => {
	try {
		const offsets = await admin.fetchTopicOffsets(req.params.topic)
		try {
			const config = await getTopicConfig(req.params.topic)
			res.status(200).json({offsets, config})
		}
		catch (error) {
			console.error(`Error while fetching config for topic ${req.params.topic}:`, error)
			res.status(200).json({offsets})
		}
	}
	catch (error) {
		res.status(500).json({ error })
	}
})

app.get("/api/topic/:topic/config", async (req, res) => {
	try {
		const config = await getTopicConfig(req.params.topic)
		res.status(200).json(config)
	}
	catch (error) {
		res.status(500).json({ error })
	}
})

app.get("/api/groups", async (req, res) => {
	try {
		const consumers = await admin.listGroups()
		const ids = consumers.groups.map(g => g.groupId)
		const groups = await admin.describeGroups(ids)
		res.status(200).json(groups)
	}
	catch (error) {
		res.status(500).json({ error })
	}
})

app.get("/api/members/:group", async (req, res) => {
	try {
		const groups = await admin.describeGroups([req.params.group]) as any //https://github.com/tulios/kafkajs/issues/756
		res.status(200).json(groups.groups[0].members)
	}
	catch (error) {
		res.status(500).json({ error })
	}
})

app.get("/api/cluster", async (req, res) => {
	try {
		const cluster = await admin.describeCluster()
		res.status(200).json(cluster)
	}
	catch (error) {
		res.status(500).json({ error })
	}
})

app.get("/api/messages/:topic/:partition", async (req, res) => {
	try {
		let limit = req.query.limit ? parseInt(req.query.limit.toString()) : 100
		const offset = req.query.offset ? parseInt(req.query.offset.toString()) : 0
		const topic = req.params.topic
		const search = req.query.search ? req.query.search as string : ""
		const timeout = req.query.timeout ? parseInt(req.query.timeout.toString()) : 20000
		const partition = parseInt(req.params.partition)
		const partitions = await admin.fetchTopicOffsets(topic)
		for (const partitionOffsets of partitions) {
			if (partitionOffsets.partition !== partition) {
				continue
			}
			const maxOffset = parseInt(partitionOffsets.high)
			if (maxOffset === 0 || offset > maxOffset) {
				res.status(200).json({messages: []})
				return
			}
			if (offset + limit > maxOffset) {
				limit = maxOffset - offset
			}
			const messages = await getMessages({topic, partition, limit, offset, search, timeout})
			res.status(200).json(messages)
			return
		}
		res.status(404).json(`partition ${partition} not found for topic ${topic}`)
	}
	catch (error) {
		res.status(500).json({ error })
	}
})

app.get("/api/messages-cross-topics/:topics", async (req, res) => {
	try {
		req.setTimeout(300000) //5 minutes timeout on the entire request

		const limit = req.query.limit ? parseInt(req.query.limit.toString()) : 100
		const fromBeginning = req.query.search_from === `Beginning`
		const search = req.query.search ? req.query.search.toString() : ""
		let messages: MessageInfo[] = []
		const topics = req.params.topics.split(`,`)
		let hasTimeout = false
		for (const topic of topics) {
			const partitions = await admin.fetchTopicOffsets(topic)
			for (const partition of partitions) {
				const low = parseInt(partition.low)
				const high = parseInt(partition.high)
				if (high === 0) {
					continue
				}
				const offset = fromBeginning ? low : Math.max(parseInt(partition.high) - limit, low)
				let partitionLimit = offset + limit > high ? high - offset : limit
				console.log(`Getting messages for topic ${topic}, partition ${partition.partition}`)
				const partitionMessages = await getMessages({topic, partition: partition.partition, limit: partitionLimit, offset, search })
				console.log(`Done getting messages for topic ${topic}, partition ${partition.partition} (#${partitionMessages.messages.length}, timeout = ${partitionMessages.hasTimeout})`)
				messages = messages.concat(partitionMessages.messages)
				hasTimeout = hasTimeout || partitionMessages.hasTimeout
			}
		}
		console.log(`Done getting all messages (#${messages.length})`)
		res.status(200).json({messages, hasTimeout})
	}
	catch (error) {
		console.error(`Error getting all messages: ${error}`)
		res.status(500).json({ error })
	}
})

app.get("/api/schema-registry/subjects", async (req, res) => {
	try {
		const subjects = await schemaRegistry.getSubjects()
		res.status(200).json(subjects)
	}
	catch (error) {
		res.status(500).json({ error })
	}
});

app.get("/api/schema-registry/versions/:subject", async (req, res) => {
	try {
		const versions = await schemaRegistry.getSubjectVersions(req.params.subject)
		res.status(200).json(versions)
	}
	catch (error) {
		res.status(500).json({ error })
	}
})

app.get("/api/schema-registry/schema/:subject/:version", async (req, res) => {
	try {
		const schema = await schemaRegistry.getSubjectVersionSchema(req.params.subject, parseInt(req.params.version))
		res.status(200).json(schema)
	}
	catch (error) {
		res.status(500).json({ error })
	}
})

app.get("/*", (req, res) => {
	res.render("index");
});

const getTopicConfig = async (topic: string) :Promise<DescribeConfigResponse> => {
	return await admin.describeConfigs({
		includeSynonyms: false,
		resources: [
			{
			type: ResourceTypes.TOPIC,
			name: topic
			}
		]
	})
}

const getMessages = async (input: TopicQueryInput): Promise<MessagesResult> => {
	const groupId = `krowser-${Date.now()}=${uuidv4()}`
	const consumer = kafka.consumer({ groupId })
	await consumer.connect()

	const messages: MessageInfo[] = []
	let numConsumed = 0
	console.log(`Querying topic ${input.topic} (partition ${input.partition}) at offset=${input.offset}, limit=${input.limit}`)
	consumer.subscribe({ topic: input.topic, fromBeginning: true })
	const consumed: Set<string> = new Set<string>()
	let hasTimeout = false
	const p = new Promise<void>(async (resolve, reject) => {
		setTimeout(() => {
			hasTimeout = true
			resolve()
		}, input.timeout || 20000);
		await consumer.run({
			autoCommit: false,
			eachMessage: async ({ topic, partition, message }) => {
				console.log(`---MESSAGE: ${message.offset}---`)
				let schemaType : Type | undefined = undefined;
				try {
					const { type, value } = await schemaRegistry.decodeWithType<any>(message.value);
					message.value = value;
					schemaType = type;
				} catch (error) {
					console.log(`Not an avro message? error: ${error}`);
				}
				const value = message.value ? message.value.toString() : "";
				const key = message.key ? message.key.toString() : "";
				console.log({
					partition,
					offset: message.offset,
					value: value,
					schemaType: schemaType,
					key: key,
				})

				if (topic !== input.topic) {
					console.log(`Ignoring message from a different topic: ${topic} (expecting ${input.topic})`)
					return
				}

				if (consumed.has(message.offset)) {
					console.log(`Ignoring duplicate message from offset ${message.offset}`)
					return
				}
				consumed.add(message.offset)

				const offset = parseInt(message.offset)
				if (offset < input.offset) {
					console.log(`Ignoring message from an old offset: ${offset} (expecting at least ${input.offset})`)
					return
				}
				numConsumed++
				let filteredOut = false
				if (input.search) {
					if (!value.includes(input.search) && !key.includes(input.search)) {
						filteredOut = true
						console.log(`Ignoring message from offset ${message.offset}, filtered out by search`)
					}
				}
				if (!filteredOut) {
					messages.push({ topic, partition, message, key, value, schemaType })
				}
				if (numConsumed >= input.limit) {
					resolve()
				}
			},
		})
	})

	consumer.seek({ topic: input.topic, partition: input.partition, offset: input.offset.toString() })
	try {
		await p;
		return { messages, hasTimeout }
	}
	finally {
		cleanupConsumer(consumer, groupId) //not awaiting this as we don't want to block the response
	}
}

const cleanupConsumer = async (consumer: Consumer, groupId: string) => {
	try {
		await consumer.stop()
	}
	catch (error) {
		console.error(`error stopping consumer`, error)
	}
	for (var i = 3; i >= 0; i--) {
		try {
			const res = await admin.deleteGroups([groupId])
			console.log(`Delete consumer group ${res[0].groupId} result: ${res[0].errorCode || "success"}`)
			return
		}
		catch (error) {
			console.error(`Error deleting consumer group ${groupId} (retries left = ${i}):`, error)
			await new Promise( resolve => setTimeout(resolve, 300) );
		}
	}
}

export const start = async (port: number): Promise<void> => {
	const server = http.createServer(app);

	console.log(`connecting to admin`)
	let connected = false
	while (!connected) {
		try {
			await admin.connect()
			connected = true
		} catch (error) {
			console.error("Error connecting admin, retrying in a second", error)
			await new Promise( resolve => setTimeout(resolve, 1000) );
		}
	}
	console.log(`connected to admin`)

	return new Promise<void>((resolve, reject) => {
		server.listen(port, resolve);
	});
};
