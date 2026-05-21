Storefront: adding services & products

This document explains how to add services (Salon/Clinic) and products (Retailer) so they appear in the public booking page and in the signage player.

Services (Salon / Clinic)
- Go to the storefront page in the admin console (Storefront).
- Under Services and pricing, click "Add service".
- Fill name, price, duration (mins), description and optionally upload an image.
- Tags: add comma-separated tags (e.g., "maxi, summer") to help voice/category matching.
- Save the profile. The backend stores services with `tags: []` as an array — ensure tags are comma-separated strings in the UI.

Products (Retailer)
- Go to the Retailer panel in Storefront.
- Click Add product and provide `name`, `price`, `sku` (useful for voice exact-match), `description`, `image_url` and `stock`.
- Tags help grouping by category. Use descriptive tags like "maxi", "pink", "summer".

Voice matching tips
- For reliable voice-to-product mapping, set SKU or unique product name.
- Add tags for category queries (e.g., "maxi") to show a product group.
- Avoid duplicate product names; include SKU when possible.

Developer notes
- The player supports product group takeover: when multiple products match a category term, it shows a product_group overlay.
- The backend `ServiceItem` now accepts `tags: List[str]` to match frontend payloads.
- If signage doesn't show products, run a frontend build and ensure the provider has products in the `products` array.
