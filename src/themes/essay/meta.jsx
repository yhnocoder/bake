export function PageMeta(props) {
  const { site, type, title, description, link, image, root } = props;
  return (
    <>
      <link rel="canonical" href={link} />
      <link rel="alternate" type="application/rss+xml" href={`${root}feed.xml`} title={site.title} />
      <meta property="og:type" content={type} />
      <meta property="og:title" content={title} />
      {description === undefined ? null : <meta property="og:description" content={description} />}
      <meta property="og:url" content={link} />
      <meta property="og:site_name" content={site.title} />
      <meta property="og:locale" content={site.language.replace('-', '_')} />
      <meta name="twitter:card" content={image === undefined ? 'summary' : 'summary_large_image'} />
      {image === undefined ? null : (
        <>
          <meta property="og:image" content={image.link} />
          <meta property="og:image:type" content={image.type} />
          <meta property="og:image:width" content={String(image.width)} />
          <meta property="og:image:height" content={String(image.height)} />
          <meta name="twitter:image" content={image.link} />
        </>
      )}
    </>
  );
}
