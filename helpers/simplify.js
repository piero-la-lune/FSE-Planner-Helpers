/*

Get a simplified version of icaodata.json file

-i    FSE Planner icaodata.json file
-o    Output icaodata.json file

*/

const fs = require('fs');

const argv = require('minimist')(process.argv.slice(2));

if (!argv.i) {
  throw new Error('Missing parameter -i');
}
if (!argv.o) {
  throw new Error('Missing parameter -o');
}

console.log('Loading data');

const icaodata = require(argv.i);

const output = {};

for (const icao of Object.keys(icaodata)) {
    output[icao] = [icaodata[icao].lat, icaodata[icao].lon];
}

fs.writeFileSync(argv.o, JSON.stringify(output, null), (err) => { console.log(err); });

console.log('Done');

process.exit();