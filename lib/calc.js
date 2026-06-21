'use strict';

const adhan = require('adhan-extended');

const HIGH_LAT_RULES = {
  TwilightAngle:     adhan.HighLatitudeRule.TwilightAngle,
  MiddleOfTheNight:  adhan.HighLatitudeRule.MiddleOfTheNight,
  SeventhOfTheNight: adhan.HighLatitudeRule.SeventhOfTheNight,
};

// Abu Dhabi — used when no valid location is configured.
const DEFAULT_LAT = 24.45;
const DEFAULT_LNG = 54.37;

// Build adhan CalculationParameters from a saved `calculation` settings object.
// Unknown/missing method falls back to Dubai; madhab/highLat applied if valid.
function buildParams(calc = {}) {
  const fn = adhan.CalculationMethod[calc.method];
  const params = (typeof fn === 'function' ? fn : adhan.CalculationMethod.Dubai)();
  params.madhab = calc.madhab === 'Hanafi' ? adhan.Madhab.Hanafi : adhan.Madhab.Shafi;
  if (calc.highLat && HIGH_LAT_RULES[calc.highLat]) {
    params.highLatitudeRule = HIGH_LAT_RULES[calc.highLat];
  }
  return params;
}

// Resolve coordinates from Homey geolocation or manual settings, guarding
// against NaN (e.g. a non-numeric manual entry) by falling back to defaults.
function resolveCoords(homey) {
  const loc = homey.settings.get('location') || {};
  const useHomeyLoc = loc.useHomeyLoc !== false;
  let lat = useHomeyLoc ? homey.geolocation.getLatitude()  : parseFloat(loc.lat);
  let lng = useHomeyLoc ? homey.geolocation.getLongitude() : parseFloat(loc.lng);
  if (!Number.isFinite(lat)) lat = DEFAULT_LAT;
  if (!Number.isFinite(lng)) lng = DEFAULT_LNG;
  return new adhan.Coordinates(lat, lng);
}

module.exports = { buildParams, resolveCoords, DEFAULT_LAT, DEFAULT_LNG };
