// <define:__ROUTES__>
var define_ROUTES_default = {
  version: 1,
  include: ["/api/*"],
  exclude: []
};

// node_modules/wrangler/templates/pages-dev-pipeline.ts
import worker from "/workspaces/webapp/.wrangler/tmp/pages-xqzmJd/bundledWorker-0.9677732512539234.mjs";
import { isRoutingRuleMatch } from "/workspaces/webapp/node_modules/wrangler/templates/pages-dev-util.ts";
export * from "/workspaces/webapp/.wrangler/tmp/pages-xqzmJd/bundledWorker-0.9677732512539234.mjs";
var routes = define_ROUTES_default;
var pages_dev_pipeline_default = {
  fetch(request, env, context) {
    const { pathname } = new URL(request.url);
    for (const exclude of routes.exclude) {
      if (isRoutingRuleMatch(pathname, exclude)) {
        return env.ASSETS.fetch(request);
      }
    }
    for (const include of routes.include) {
      if (isRoutingRuleMatch(pathname, include)) {
        const workerAsHandler = worker;
        if (workerAsHandler.fetch === void 0) {
          throw new TypeError("Entry point missing `fetch` handler");
        }
        return workerAsHandler.fetch(request, env, context);
      }
    }
    return env.ASSETS.fetch(request);
  }
};
export {
  pages_dev_pipeline_default as default
};
//# sourceMappingURL=vfcgvrhzih8.js.map
