declare module "virtual:arena-public-blind" {
  const bundle: Pick<import("./public-types").PublicReleaseBundle, "schema" | "blind" | "catalog" | "taskManifests">;
  export default bundle;
}

declare module "virtual:arena-public-named" {
  const release: import("./public-types").PublicRelease;
  export default release;
}
