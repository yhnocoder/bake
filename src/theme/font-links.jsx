export function FontLinks(props) {
  return props.hrefs.map((href) => (
    <>
      <link rel="preload" as="style" href={href} attr:onload="this.rel='stylesheet'" />
      <noscript>
        <link rel="stylesheet" href={href} />
      </noscript>
    </>
  ));
}
