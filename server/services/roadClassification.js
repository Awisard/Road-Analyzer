const ROAD_CLASSES = {
  EXPRESSWAY: 'Expressways / Freeways',
  NATIONAL: 'National / Principal Highways',
  STATE: 'State / Major Arterial Roads',
  COLLECTOR: 'Collector / Minor District Roads',
  LOCAL: 'Local / Village / Single-Lane Roads',
  URBAN: 'Urban / Residential Streets',
  UNKNOWN: 'Insufficient road data',
};

function classifyRoad({ laneCount, laneWidthM }) {
  const width = Number.isFinite(laneWidthM) ? laneWidthM : null;

  if (!Number.isInteger(laneCount) || laneCount < 1) {
    return {
      name: ROAD_CLASSES.UNKNOWN,
      basis: 'No lane detections were available; provide a clearer image or enter the lane count manually.',
    };
  }

  if (laneCount >= 6) {
    return {
      name: ROAD_CLASSES.EXPRESSWAY,
      basis: `${laneCount} detected lanes; divided multi-lane road category.`,
    };
  }

  if (laneCount >= 4) {
    return {
      name: ROAD_CLASSES.NATIONAL,
      basis: `${laneCount} detected lanes; principal highway category.`,
    };
  }

  if (laneCount === 3) {
    return {
      name: ROAD_CLASSES.STATE,
      basis: '3 detected lanes; major arterial category.',
    };
  }

  if (laneCount === 2 && width !== null && width >= 2.75 && width < 3.0) {
    return {
      name: ROAD_CLASSES.URBAN,
      basis: `2 detected lanes at ${width.toFixed(2)} m per lane; narrow urban-street range. This may also match a collector road without urban context.`,
    };
  }

  if (laneCount === 2 && width !== null && width >= 3.0 && width <= 3.25) {
    return {
      name: ROAD_CLASSES.COLLECTOR,
      basis: `2 detected lanes at ${width.toFixed(2)} m per lane; collector-road range.`,
    };
  }

  if (laneCount === 2) {
    return {
      name: ROAD_CLASSES.STATE,
      basis: width === null
        ? '2 detected lanes; width not provided, so classified as a general major arterial.'
        : `2 detected lanes at ${width.toFixed(2)} m per lane; arterial range.`,
    };
  }

  if (laneCount === 1) {
    return {
      name: ROAD_CLASSES.LOCAL,
      basis: width === null
        ? '1 detected lane; local or village-road category.'
        : `1 detected lane at ${width.toFixed(2)} m; single-lane road category.`,
    };
  }

  return {
    name: ROAD_CLASSES.STATE,
    basis: `${laneCount} detected lanes; major arterial category.`,
  };
}

module.exports = { ROAD_CLASSES, classifyRoad };
