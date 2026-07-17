import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  project: "proj_tfzflqzobnbwhitxnzpe",
  runtime: "node",
  logLevel: "log",
  // The max compute seconds a task is allowed to run. If the task run exceeds this duration, it will be stopped.
  // You can override this on an individual task.
  // See https://trigger.dev/docs/runs/max-duration
  maxDuration: 3600,
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
      randomize: true,
    },
  },
  dirs: ["./src/trigger"],
  build: {
    // @huggingface/transformers loads onnxruntime-node's native .node binary via
    // a computed require path (`../bin/napi-v6/${platform}/${arch}/...`), which
    // esbuild cannot bundle and autoDetectExternal cannot see through — it only
    // matches static requires. Naming it here keeps it a runtime dependency.
    //
    // Both packages must be listed by package name: the docs require any package
    // that installs a native binary or uses WASM to be external. Externals get an
    // auto-generated package.json in the build dir and are npm-installed into the
    // deployed image, so this works in prod too.
    external: ["onnxruntime-node", "@huggingface/transformers"],
  },
});
