// The declarations live beside the Node entry point, as CommonJS like it, so
// that TypeScript lets a CommonJS project require() the package. An ES
// module may import from CommonJS, so the browser entry point shares them.
export * from './node.cjs'
