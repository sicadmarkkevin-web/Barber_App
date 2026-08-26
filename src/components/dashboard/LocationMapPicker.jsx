import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Leaflet's default marker icon paths break once bundled (they reference
// relative image paths that don't survive a build) — this is the standard
// fix: point them at the actual bundled asset URLs instead.
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

const DEFAULT_CENTER = [14.5995, 120.9842]; // Manila — a reasonable fallback center for a PH-focused app, not a real business location

/**
 * A business-location picker: click anywhere on the map, or drag the pin,
 * to set lat/lng. Plain Leaflet + OpenStreetMap tiles (no react-leaflet
 * wrapper) — free, no API key, and keeps the dependency footprint small.
 * Purely a controlled input: it reports changes via onChange and re-centers
 * if lat/lng change from outside (e.g. the existing "Use my current
 * location" button), but never owns the actual saved value itself.
 */
export default function LocationMapPicker({ lat, lng, onChange }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Initialize once. Re-running this on every lat/lng change would tear
  // down and rebuild the whole map on every pin move — the sync effect
  // below handles external updates instead.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const start = lat != null && lng != null ? [lat, lng] : DEFAULT_CENTER;
    const map = L.map(containerRef.current).setView(start, lat != null ? 16 : 12);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);

    const marker = L.marker(start, { draggable: true }).addTo(map);
    marker.on("dragend", () => {
      const pos = marker.getLatLng();
      onChangeRef.current(pos.lat, pos.lng);
    });
    map.on("click", (e) => {
      marker.setLatLng(e.latlng);
      onChangeRef.current(e.latlng.lat, e.latlng.lng);
    });

    mapRef.current = map;
    markerRef.current = marker;

    // Leaflet sometimes mis-measures its container if it was hidden/mid
    // layout at creation time (common inside a card that just mounted) —
    // a short delayed resize check fixes blank/cut-off tiles.
    const resizeTimer = setTimeout(() => map.invalidateSize(), 150);

    return () => {
      clearTimeout(resizeTimer);
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // External updates (the "Use my current location" button, or the barber's
  // already-saved location loading in) move the existing marker/map instead
  // of rebuilding them.
  useEffect(() => {
    if (!mapRef.current || !markerRef.current || lat == null || lng == null) return;
    markerRef.current.setLatLng([lat, lng]);
    const currentZoom = mapRef.current.getZoom();
    mapRef.current.setView([lat, lng], currentZoom < 14 ? 16 : currentZoom);
  }, [lat, lng]);

  return <div ref={containerRef} className="location-map-picker" />;
}