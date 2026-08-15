import { supabase } from "../lib/supabaseClient";

/**
 * Resizes an image file client-side via canvas, same approach as the original
 * app's resizeImageFile — but returns a Blob (for upload) instead of a base64
 * data URL (which the original stored directly in the database).
 */
export function resizeImageToBlob(file, maxDim = 800, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Could not load that image."));
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDim) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else if (height > maxDim) {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not process that image."))), "image/jpeg", quality);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8MB — generous ceiling before we even try to resize

/**
 * Resizes and uploads an image to a Supabase Storage bucket, returning the
 * public URL. "Replace photo" is implemented as remove-then-insert rather
 * than `upsert: true`, working around a project-specific Storage error
 * (`DatabaseInvalidObjectDefinition` — "The database schema is invalid or
 * incompatible") that the upsert code path's internal `ON CONFLICT` query
 * triggers on this Supabase project. If Supabase support resolves that
 * server-side, `upsert: true` can be restored — this is a workaround, not
 * something wrong in our own schema (see the 2026-08 debugging thread).
 */
export async function uploadImage(bucket, path, file) {
  if (!file.type.startsWith("image/")) {
    throw new Error("Please choose an image file.");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error("That image is too large. Please choose one under 8MB.");
  }

  const blob = await resizeImageToBlob(file);
  const uploadOptions = { upsert: false, contentType: "image/jpeg", cacheControl: "3600" };

  let { error: uploadError } = await supabase.storage.from(bucket).upload(path, blob, uploadOptions);

  if (uploadError && (uploadError.statusCode === "409" || /exists/i.test(uploadError.message || ""))) {
    // Replacing an existing photo: remove the old object, then insert fresh
    // instead of upserting, since upsert's ON CONFLICT path is what's broken.
    const { error: removeError } = await supabase.storage.from(bucket).remove([path]);
    if (removeError) {
      console.error(`Couldn't remove existing ${bucket}/${path} before replace:`, removeError);
      throw removeError;
    }
    ({ error: uploadError } = await supabase.storage.from(bucket).upload(path, blob, uploadOptions));
  }

  if (uploadError) {
    console.error(`Upload to ${bucket}/${path} failed:`, uploadError);
    throw uploadError;
  }

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  // Cache-bust so a replaced photo shows immediately instead of a stale cached copy.
  return `${data.publicUrl}?v=${Date.now()}`;
}
