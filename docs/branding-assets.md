# Small UI branding asset

`public/branding/cx-codex-ui-icon-192.png` is a byte-for-byte copy of the existing `android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png` (192×192 PNG). The existing branding generator derives the launcher and public app icon from the same source artwork.

Use it for small UI icons, currently at most 56 CSS pixels. It covers a 3× display without loading the 1024px original. Existing dimensions, alt text and interaction remain defined by their components.

The original public branding assets and all Android resources remain unchanged. Large image-preview regression samples retain their original resource URLs. The small copy adds to installed assets; the saving is in UI image requests and decoding, not removal of the retained originals.

After an intentional brand change, regenerate the Android artwork through the established branding process, then copy the corresponding 192px launcher to the UI resource and verify both files match. No additional image library or runtime transformation is required.
