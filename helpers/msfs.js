/*

Compute MSFS airports within each FSE airport landing zone

You first need to load MSFS assets with Little Navmap, then export table `airport`
from Little Navmap MSFS SQLite database to a CSV file

-f    CSV file (export from Little Navmap)
-i    FSE Planner icaodata.json file
-z    FSE Planner zones.json file
-o    Output icaodata.json file
-m    Output msfs.json file

*/

const geolib = require('geolib');
const fs = require('fs');
const csv = require('csv-parser');
const cliProgress = require('cli-progress');
const { kdTree } = require('kd-tree-javascript');

const argv = require('minimist')(process.argv.slice(2));

if (!argv.f) {
  throw new Error('Missing parameter -f');
}
if (!argv.i) {
  throw new Error('Missing parameter -i');
}
if (!argv.z) {
  throw new Error('Missing parameter -z');
}
if (!argv.o) {
  throw new Error('Missing parameter -o');
}
if (!argv.m) {
  throw new Error('Missing parameter -m');
}

console.log('Loading data');

// Load icaodata file, clean and arrange data
const icaodata = require(argv.i);
const icaos = Object.keys(icaodata);
const zones = require(argv.z);
const points = [];
for (const icao of icaos) {
  console.log(icao);
  zones[icao] = zones[icao].map(([lat, lon]) => [lon, lat]);
  icaodata[icao].msfs = [];
  points.push({lon: icaodata[icao].lon, lat: icaodata[icao].lat, icao: icao});
}
const tree = new kdTree(points, (a, b) => geolib.getDistance([a.lon, a.lat], [b.lon, b.lat]), ["lon", "lat"]);

var surfaces = {
  A: 1,
  B: 1,
  D: 3,
  CE: 2,
  W: 8,
  G: 4,
  GR: 5,
  CR: 3,
  S: 3,
  OT: 1,
  M: 1,
  SN: 7,
  C: 2,
  T: 1
}

// Load MSFS extract CSV file
const msfs = [];
fs.createReadStream(argv.f)
  .pipe(csv())
  .on('data', (data) => msfs.push(data))
  .on('end', () => {

    // Initiate progress bar
    const bar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
    console.log('Analyzing all MSFS airports');
    bar.start(msfs.length, 0);

    const ignored = [];
    const obj = {};

    // Counter
    for (const airport of msfs) {
      if (airport.is_closed === '1') {
        bar.increment();
        continue;
      }

      // Search the matching zone
      if (icaodata[airport.ident] && geolib.isPointInPolygon([airport.lonx, airport.laty], zones[airport.ident])) {
        icaodata[airport.ident].msfs.push({
          icao: airport.ident,
          lat: airport.laty,
          lon: airport.lonx,
          runway: parseInt(airport.longest_runway_length),
          surface: surfaces[airport.longest_runway_surface]
        });
      }
      else {
        const point = {lon: airport.lonx, lat: airport.laty};
        const nearest = tree.nearest(point, 2);
        const dir1 = geolib.getGreatCircleBearing(nearest[1][0], point);
        const dir2 = geolib.getGreatCircleBearing(nearest[1][0], nearest[0][0]);
        const angle1 = (((dir1 - dir2) % 360) + 360) % 360;
        const angle2 = (((dir2 - dir1) % 360) + 360) % 360;
        const angle = Math.min(angle1, angle2);
        const dist = geolib.getDistance(nearest[0][0], nearest[1][0]);
        const dProjected = dist - 2*(
          Math.cos(
            angle * Math.PI / 180
          ) * nearest[1][1]
        );
        // if (airport.ident === "LECM") {
        //   console.log(nearest);
        //   console.log(dist);
        //   console.log(dProjected);
        //   process.exit();
        // }
        if (dist > 0 && angle < 90 && dProjected < 600 && (dProjected/dist < 0.2)) {
           ignored.push(airport.ident);
        }
        else {
          icaodata[nearest[1][0].icao].msfs.push({
            icao: airport.ident,
            lat: airport.laty,
            lon: airport.lonx,
            runway: parseInt(airport.longest_runway_length),
            surface: surfaces[airport.longest_runway_surface]
          });
        }
      }
      obj[airport.ident] = {
        lon: parseFloat(airport.lonx),
        lat: parseFloat(airport.laty)
      }
      bar.increment();
    }

    bar.stop();

    console.log('Ignored (equal distance to 2 FSE airports): ', ignored.sort().join(' '));

    console.log('Cleaning up');
    for (const icao of icaos) {
      if (icaodata[icao].msfs.length > 0) {
        const sortedArr = geolib.orderByDistance(icaodata[icao], icaodata[icao].msfs);
        if (icao !== sortedArr[0].icao && geolib.getDistance(sortedArr[0], icaodata[icao]) > 2000) {
          sortedArr.unshift(null);
        }
        else {
          icaodata[icao].surface = sortedArr[0].surface;
          icaodata[icao].runway = sortedArr[0].runway;
        }
        icaodata[icao].msfs = sortedArr.map(obj => obj ? obj.icao : null);
      }
      else {
        icaodata[icao].msfs.unshift(null);
      }
    }

    console.log('Saving file');

    fs.writeFileSync(argv.o, JSON.stringify(icaodata, null, '  '), (err) => { console.log(err); });
    fs.writeFileSync(argv.m, JSON.stringify(obj, null, '  '), (err) => { console.log(err); });

    console.log('Done');

    process.exit();

  });
