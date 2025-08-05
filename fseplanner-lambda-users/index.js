const axios = require('axios');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const REGION = 'eu-west-3';
const s3 = new S3Client({ region: REGION });

exports.handler = async (event) => {
    
    try {
        let res = await axios.get('https://server.fseconomy.net/scoredata.jsp?type=groups');
        const groups = [...res.data.data.map(e => e.accountName)];
    
        res = await axios.get('https://server.fseconomy.net/scoredata.jsp');
        const pilots = [...res.data.data.map(e => e.accountName)];
    
        const file = JSON.stringify([...groups, ...pilots], null, '  ');

        var uploadParams = {
            Bucket: 'fse-planner-data',
            Key: 'users.json',
            Body: file,
            CacheControl: 'no-cache'
        };
        const command = new PutObjectCommand(uploadParams);
        const stored = await s3.send(command);
    
        return {
            statusCode: 200,
            body: stored
        }
    }
    catch (e) {
        console.log(e)
        return {
            statusCode: 400,
            body: JSON.stringify(e)
        }
    }
};