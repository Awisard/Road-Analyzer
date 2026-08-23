/**
 * Ground-truth distance measurement from a nadir (straight-down) drone photo.
 *
 * A single 2D photo has no inherent scale — 10 pixels could be 10cm or 10m.
 * A drone at a KNOWN altitude with a KNOWN camera (focal length + sensor width)
 * fixes that: standard aerial-photogrammetry formula for Ground Sample Distance
 * (real-world size represented by one pixel):
 *
 *   GSD (m/px) = (sensorWidth_mm * altitude_m) / (focalLength_mm * imageWidth_px)
 *
 * This assumes:
 *   - the camera points straight down (nadir), not at an angle
 *   - the ground under the drone is roughly flat
 * If the camera is angled, this becomes a rough estimate, not a precise one —
 * true oblique-shot measurement needs a full homography with the tilt angle.
 */

function estimateGSD({ sensorWidthMm, focalLengthMm, altitudeM, imageWidthPx }) {
  if (!sensorWidthMm || !focalLengthMm || !altitudeM || !imageWidthPx) {
    return null;
  }
  return (sensorWidthMm * altitudeM) / (focalLengthMm * imageWidthPx);
}

function pixelsToMeters(pixelLength, gsdMetersPerPixel) {
  if (!gsdMetersPerPixel) return null;
  return +(pixelLength * gsdMetersPerPixel).toFixed(2);
}

// Common drone camera presets (sensor width in mm, typical focal length in mm).
// Users can override these with their exact drone's spec sheet values.
const DRONE_PRESETS = {
  'dji-mavic-3': { sensorWidthMm: 17.3, focalLengthMm: 12.29, label: 'DJI Mavic 3' },
  'dji-phantom-4': { sensorWidthMm: 13.2, focalLengthMm: 8.8, label: 'DJI Phantom 4 Pro' },
  'dji-mini-4-pro': { sensorWidthMm: 9.7, focalLengthMm: 6.72, label: 'DJI Mini 4 Pro' },
  custom: { sensorWidthMm:13, focalLengthMm: 13, label: 'Custom (enter manually)' },
};

module.exports = { estimateGSD, pixelsToMeters, DRONE_PRESETS };
