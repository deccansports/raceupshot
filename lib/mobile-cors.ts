export const mobileCorsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
  "access-control-allow-headers": "Accept, Authorization, Content-Type",
  "access-control-max-age": "86400",
};

export function mobileCorsPreflight() {
  return new Response(null, { status: 204, headers: mobileCorsHeaders });
}
