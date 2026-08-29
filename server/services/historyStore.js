const { MongoClient, GridFSBucket, ObjectId } = require('mongodb');

const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
const databaseName = process.env.MONGODB_DB || 'road-analyzer';

let client;
let database;
let bucket;
let connectionPromise;

async function getDatabase() {
  if (!mongoUri) throw new Error('MONGODB_URI is not configured');
  if (database) return database;
  if (!connectionPromise) {
    connectionPromise = MongoClient.connect(mongoUri).then((connectedClient) => {
      client = connectedClient;
      database = client.db(databaseName);
      bucket = new GridFSBucket(database, { bucketName: 'analysisImages' });
      return database;
    });
  }
  return connectionPromise;
}

function toObjectId(id) {
  return ObjectId.isValid(id) ? new ObjectId(id) : null;
}

function dataUrlToBuffer(dataUrl) {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl || '');
  if (!match) throw new Error('Invalid analysis image data');
  return { contentType: match[1], buffer: Buffer.from(match[2], 'base64') };
}

function uploadImage(image, filename) {
  return new Promise((resolve, reject) => {
    const upload = bucket.openUploadStream(filename, { contentType: image.contentType });
    upload.on('error', reject);
    upload.on('finish', () => resolve(upload.id));
    upload.end(image.buffer);
  });
}

async function saveAnalysis({ originalBuffer, originalContentType, originalName, result, parameters }) {
  await getDatabase();
  const originalImage = { buffer: originalBuffer, contentType: originalContentType || 'application/octet-stream' };
  const overlayImage = dataUrlToBuffer(result.overlayPngBase64);
  const [originalFileId, overlayFileId] = await Promise.all([
    uploadImage(originalImage, originalName || 'uploaded-image'),
    uploadImage(overlayImage, 'analysis-overlay.png'),
  ]);

  const document = {
    createdAt: new Date(),
    originalName: originalName || 'uploaded-image',
    originalContentType: originalImage.contentType,
    originalFileId,
    overlayFileId,
    parameters,
    imageWidth: result.width,
    imageHeight: result.height,
    roadType: result.roadType,
    roadTypeBasis: result.roadTypeBasis,
    classCounts: result.classCounts || {},
    classBreakdown: result.classBreakdown || {},
    measurement: result.measurement,
    roadPixelLength: result.roadPixelLength,
  };
  const insertResult = await database.collection('analyses').insertOne(document);
  return { ...document, _id: insertResult.insertedId };
}

function serializeHistory(document) {
  return {
    id: document._id.toString(),
    createdAt: document.createdAt,
    originalName: document.originalName,
    imageWidth: document.imageWidth,
    imageHeight: document.imageHeight,
    roadType: document.roadType,
    roadTypeBasis: document.roadTypeBasis,
    classCounts: document.classCounts,
    classBreakdown: document.classBreakdown,
    measurement: document.measurement,
    imageUrl: `/api/history/${document._id}/image/original`,
    overlayUrl: `/api/history/${document._id}/image/overlay`,
  };
}

async function listAnalyses() {
  await getDatabase();
  const documents = await database.collection('analyses').find().sort({ createdAt: -1 }).limit(100).toArray();
  return documents.map(serializeHistory);
}

async function getAnalysis(id) {
  const objectId = toObjectId(id);
  if (!objectId) return null;
  await getDatabase();
  return database.collection('analyses').findOne({ _id: objectId });
}

function streamImage(fileId, response) {
  const stream = bucket.openDownloadStream(fileId);
  stream.on('error', () => response.sendStatus(404));
  stream.pipe(response);
}

async function streamAnalysisImage(id, imageType, response) {
  const document = await getAnalysis(id);
  if (!document) return response.sendStatus(404);
  const fileId = imageType === 'overlay' ? document.overlayFileId : document.originalFileId;
  response.type(imageType === 'overlay' ? 'png' : document.originalContentType);
  streamImage(fileId, response);
}

async function deleteAnalysis(id) {
  const document = await getAnalysis(id);
  if (!document) return false;
  await Promise.all([
    bucket.delete(document.originalFileId),
    bucket.delete(document.overlayFileId),
  ]);
  await database.collection('analyses').deleteOne({ _id: document._id });
  return true;
}

module.exports = { getDatabase, saveAnalysis, listAnalyses, getAnalysis, streamAnalysisImage, deleteAnalysis, serializeHistory };
