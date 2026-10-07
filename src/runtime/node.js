function browserOnly(name) {
  return () => {
    throw new Error(`bake/runtime ${name} is only available in the browser`);
  };
}

export const site = { pages: [], config: {} };
export const animate = browserOnly('animate');
export const layoutText = browserOnly('layoutText');
export const renderMath = browserOnly('renderMath');
