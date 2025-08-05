const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const Ajv = require("ajv");
const { lookUp } = require('./reverse-geocode/lookup');
const icaodata = require('./icaodata-simplified.json');

const REGION = 'eu-west-3';
const ddbClient = new DynamoDBClient({ region: REGION });
const dbb = DynamoDBDocumentClient.from(ddbClient);

const ajv = new Ajv();

const schema = {
  type: "object",
  properties: {
    type: {
      type: "string",
      enum: ["all", "unbuilt", "forsale", "custom", "gps"]
    },
    filters: {
      type: "object",
      properties: {
        size: {
          type: "array",
          items: { type: "integer", minimum: 0, maximum: 23500 },
          minItems: 2,
          maxItems: 2
        },
        surface: {
          type: "array",
          items: { type: "integer", minimum: 1, maximum: 8 },
          maxItems: 8
        },
        runway: {
          type: "array",
          items: { type: "integer", minimum: 0, maximum: 30000 },
          minItems: 2,
          maxItems: 2
        },
        onlySim: { type: "boolean" },
        onlySimAlternative: { type: "boolean" },
        onlyBM: { type: "boolean" },
        onlyILS: { type: "boolean" },
        excludeMilitary: { type: "boolean" },
        price: {
          type: "array",
          items: { type: "integer" },
          minItems: 2,
          maxItems: 2
        },
        area: {
          type: "array",
          items: {
            type: "array",
            items: { type: "number" },
            minItems: 2,
            maxItems: 2
          },
          maxItems: 200
        }
      },
      required: ["size", "surface", "runway", "price"],
      additionalProperties: false
    },
    display: {
      type: "object",
      properties: {
        name: {
          type: "string",
          maxLength: 60
        },
        color: {
          type: "string",
          pattern: "^#(?:[0-9a-fA-F]{3}){1,2}$"
        },
        size: {
          type: "integer",
          enum: [3, 8, 13, 20, 25]
        },
        weight: {
          type: "integer",
          enum: [1, 2, 3, 5, 10]
        },
        desc: {
          type: "string",
          maxLength: 3000
        },
        location: {
          type: "string",
          maxLength: 500
        }
      },
      required: ["name", "color", "size"],
      additionalProperties: false
    },
    data: {
      type: "object",
      properties: {
        icaos: {
          type: "array",
          items: { type: "string", maxLength: 4 },
          maxItems: 10000
        },
        connections: {
          type: "array",
          anyOf: [
            {
              items: {
                type: "array",
                items: { type: "string", maxLength: 4 },
                minItems: 2,
                maxItems: 2
              }
            },
            {
              items: {
                type: "array",
                items: { type: "integer", minimum: 0, maximum: 10000 },
                minItems: 2,
                maxItems: 2
              }
            }
          ],
          maxItems: 10000
        },
        points: {
          type: "array",
          items: {
            type: "array",
            items: [{ type: "number" }, { type: "number" }, { type: "string", maxLength: 100 }],
            minItems: 3,
            additionalItems: false
          },
          maxItems: 10000
        }
      }
    },
    shareID: { type: "string" }
  },
  required: ["type", "filters", "display", "data"],
  additionalProperties: false
};

function getLocation(layer) {
  if (layer.type !== 'custom' && layer.type !== 'gps') {
    return "World";
  }
  if (!layer.data.icaos.length && !layer.data.points.length) {
    return "World";
  }
  let latMin = [90, 0];
  let latMax = [-90, 0];
  let lonMin = [0, 180];
  let lonMax = [0, -180];
  for (let i=0; i<layer.data.icaos.length; i++) {
    const coord = icaodata[layer.data.icaos[i]];
    if (coord[0] < latMin[0]) { latMin = coord; }
    if (coord[0] > latMax[0]) { latMax = coord; }
    if (coord[1] < lonMin[1]) { lonMin = coord; }
    if (coord[1] > lonMax[1]) { lonMax = coord; }
  }
  for (let i=0; i<layer.data.points.length; i++) {
    const coord = layer.data.points[i];
    if (coord[0] < latMin[0]) { latMin = coord; }
    if (coord[0] > latMax[0]) { latMax = coord; }
    if (coord[1] < lonMin[1]) { lonMin = coord; }
    if (coord[1] > lonMax[1]) { lonMax = coord; }
  }
  const r1 = lookUp(latMin[0], latMin[1]);
  const r2 = lookUp(latMax[0], latMax[1]);
  const r3 = lookUp(lonMin[0], lonMin[1]);
  const r4 = lookUp(lonMax[0], lonMax[1]);
  if (!r1 || !r2 || !r3 || !r4) { return "World"; }
  if (r1[0] !== r2[0] || r2[0] !== r3[0] || r3[0] !== r4[0]) { return "World"; }
  let loc = r1[0];
  if (r1[1] !== r2[1] || r2[1] !== r3[1] || r3[1] !== r4[1]) { return loc; }
  loc = r1[1]+', '+loc;
  if (r1[2] !== r2[2] || r2[2] !== r3[2] || r3[2] !== r4[2]) { return loc; }
  loc = r1[2]+', '+loc;
  if (r1.length < 4 || r2.length < 4 || r3.length < 4 || r4.length < 4) { return loc; }
  if (r1[3] !== r2[3] || r2[3] !== r3[3] || r3[3] !== r4[3]) { return loc; }
  return r1[3]+', '+loc;
}

const Response = (code, obj) => {
    return {
        statusCode: code,
        body: JSON.stringify(obj, null, 4),
        headers: {
            'Content-Type': 'application/json',
        }
    };
};

exports.handler = async function (event, context, callback) {
    let body = '';

    if (event.routeKey === 'GET /layer') {
        const data = await dbb.send(new QueryCommand({
            TableName: 'fse-layers',
            IndexName: 'sharePublic-index',
            KeyConditionExpression: 'sharePublic = :v',
            ExpressionAttributeValues: {
              ":v": "x"
            }
        }));
        if (!data.Items) {
            return Response(500, {message: 'Internal error'});
        }
        else {
            return Response(200, data.Items);
        }
    }

    else if (event.routeKey === 'GET /layer/{id}') {
        const id = event.pathParameters.id;
        const data = await dbb.send(new GetCommand({
            TableName: 'fse-layers',
            Key: {
                id: id
            }
        }));
        if (!data.Item) {
            return Response(404, {message: 'Not found'});
        }
        else {
            delete data.Item.editId;
            return Response(200, data.Item);
        }
    }

    else if (event.routeKey === 'POST /layer') {
        const id = context.awsRequestId;
        const editId = require("crypto").randomBytes(16).toString('base64').replace(/[^a-zA-Z0-9]+/g, "");
        try {
            body = JSON.parse(event.body);
        }
        catch (error) {
            return Response(400, {message: error});
        }
        if (!body.version || !/^[0-9]+\.[0-9]+\.[0-9]+(-alpha\.[0-9]+)?$/.test(body.version) || !body.info || typeof body.info !== "object") {
            return Response(400, {message: 'Bad request'});
        }
        body.info.shareID = id;
        const validate = ajv.compile(schema);
        if (!validate(body.info)) {
          return Response(400, {message: 'Bad request'});
        }
        body.info.display.location = getLocation(body.info);
        await dbb.send(new PutCommand({
            TableName: 'fse-layers',
            Item: {
                id: id,
                version: body.version,
                info: body.info,
                editId: editId
            }
        }));
        return Response(200, {id: id, editId: editId});
    }

    else if (event.routeKey === 'POST /layer/{id}') {
        const id = event.pathParameters.id;
        try {
            body = JSON.parse(event.body);
        }
        catch (error) {
            return Response(400, {message: error});
        }
        if (!body.editId || !body.version || !/^[0-9]+\.[0-9]+\.[0-9]+(-alpha\.[0-9]+)?$/.test(body.version) || !body.info || typeof body.info !== "object") {
            return Response(400, {message: 'Bad request'});
        }
        let data = await dbb.send(new GetCommand({
            TableName: 'fse-layers',
            Key: {
                id: id
            }
        }));
        if (!data.Item) {
            return Response(404, {message: 'Not found'});
        }
        if (data.Item.editId !== body.editId) {
            return Response(403, {message: 'Unauthorized'});
        }
        body.info.shareID = id;
        const validate = ajv.compile(schema);
        if (!validate(body.info)) {
          return Response(400, {message: 'Bad request'});
        }
        body.info.display.location = getLocation(body.info);
        await dbb.send(new PutCommand({
            TableName: 'fse-layers',
            Item: {
                id: id,
                version: body.version,
                info: body.info,
                editId: body.editId,
                sharePublic: data.Item.sharePublic
            }
        }));
        return Response(200, {id: id, editId: body.editId});
    }

    else if (event.routeKey === 'POST /layer/{id}/public') {
        const id = event.pathParameters.id;
        try {
            body = JSON.parse(event.body);
        }
        catch (error) {
            return Response(400, {message: error});
        }
        if (!body.editId) {
            return Response(400, {message: 'Bad request'});
        }
        let data = await dbb.send(new GetCommand({
            TableName: 'fse-layers',
            Key: {
                id: id
            }
        }));
        if (!data.Item) {
            return Response(404, {message: 'Not found'});
        }
        if (data.Item.editId !== body.editId) {
            return Response(403, {message: 'Unauthorized'});
        }
        data.Item.sharePublic = 'x';
        await dbb.send(new PutCommand({
            TableName: 'fse-layers',
            Item: data.Item
        }));
        return Response(200, {id: id, editId: body.editId});
    }

    else {
        return {
            statusCode: 404,
            body: JSON.stringify(event, null, 4)
        };
    }
};
