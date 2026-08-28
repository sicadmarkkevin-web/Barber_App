
/**
 * Wraps the browser's Geolocation API in a promise with friendly, non-technical
 * error messages. Only ever called from an explicit user click (never on page
 * load, never repeated automatically) — this is a one-shot position read, not
 * tracking: no watchPosition, nothing kept running after the promise resolves.
 */
export function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject({ code: "unsupported", message: "Your browser doesn't support location access. Please enter your address manually." });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({ lat: position.coords.latitude, lng: position.coords.longitude });
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          reject({ code: "denied", message: "Location access was denied. Please enter your address manually." });
        } else {
          reject({ code: "error", message: "Couldn't determine your location. Please enter your address manually." });
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  });
}