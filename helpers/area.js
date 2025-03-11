/*

Compute FSE landing zones from a FSE Planner `icaodata.json` file

-i    FSE Planner icaodata.json file
-o    Output zones.json file

*/


const turf = require('turf');
const fs = require('fs');
const voronoi = require('d3-geo-voronoi');

const argv = require('minimist')(process.argv.slice(2));

if (!argv.i) {
  throw new Error('Missing parameter -i');
}
if (!argv.o) {
  throw new Error('Missing parameter -o');
}


/**
 * Round half up ('round half towards positive infinity')
 * Negative numbers round differently than positive numbers.
 */
function round(num, decimalPlaces = 0) {
  num = Math.round(num + "e" + decimalPlaces);
  return Number(num + "e" + -decimalPlaces);
}



const icaodata = require(argv.i);

const points = Object.entries(icaodata).map(([key, obj]) => turf.point([obj.lon, obj.lat], {name: key}));

// Compute Voronoi
const v = voronoi.geoVoronoi(points);
const polygons = v.polygons();

const fixLon = (lon, plon) => {
  if (Math.abs(lon - plon) > Math.abs(lon - 360 - plon)) {
    lon -= 360;
  }
  else if (Math.abs(lon - plon) > Math.abs(lon + 360 - plon)) {
    lon += 360;
  }
  return lon;
}

const zones = {};
for (const [icao, a] of Object.entries(icaodata)) {
  for (const obj of polygons.features) {
    if (icao === obj.properties.site.properties.name) {
      zones[icao] = obj.geometry.coordinates[0].map(([lon, lat]) => [round(lat, 4), round(fixLon(lon, a.lon), 4)]);
    }
  }
}

fs.writeFileSync(argv.o, JSON.stringify(zones, null, '  '), (err) => { console.log(err); });

process.exit();
