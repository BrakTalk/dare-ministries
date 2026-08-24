require('dotenv').config();
const { DateTime } = require('luxon');
const markdownIt = require('markdown-it');

// html: false — field note content is authored through a privileged tool, but
// raw HTML must still never reach the public site.
const md = markdownIt({ html: false, linkify: true });

module.exports = function (eleventyConfig) {
  // Pass through static assets (glob form so js/__tests__ never ships)
  eleventyConfig.addPassthroughCopy('src/css');
  eleventyConfig.addPassthroughCopy('src/js/*.js');
  eleventyConfig.addPassthroughCopy('src/images');
  // Browser-ready modules used by the custom Volunteer Portal account screens.
  // Netlify Identity's ESM build imports gotrue-js by package name, so both
  // modules are copied and resolved through an import map.
  eleventyConfig.addPassthroughCopy({
    'node_modules/@netlify/identity/dist/main.js': 'js/vendor/netlify-identity.js',
    'node_modules/gotrue-js/lib/index.js': 'js/vendor/gotrue.js',
  });

  // Date filters
  eleventyConfig.addFilter('date', function (dateObj, format) {
    const dt = dateObj === 'now' ? DateTime.now() : DateTime.fromJSDate(new Date(dateObj));
    if (format === 'YYYY-MM-DD') return dt.toFormat('yyyy-MM-dd');
    if (format === 'YYYY') return dt.toFormat('yyyy');
    return dt.toFormat(format || 'LLLL d, yyyy');
  });

  // Truncate filter
  eleventyConfig.addFilter('truncate', function (str, len) {
    if (!str) return '';
    if (str.length <= len) return str;
    return str.substring(0, len) + '...';
  });

  // Strip HTML tags
  eleventyConfig.addFilter('striptags', function (str) {
    if (!str) return '';
    return str.replace(/<[^>]*>/g, '');
  });

  // Render markdown (field note bodies) to HTML at build time
  eleventyConfig.addFilter('markdown', function (str) {
    return md.render(str || '');
  });

  // Capitalize filter
  eleventyConfig.addFilter('capitalize', function (str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  });

  return {
    dir: {
      input: 'src',
      output: '_site',
      includes: '_includes',
      data: '_data',
    },
    templateFormats: ['njk', 'md', 'html'],
    htmlTemplateEngine: 'njk',
    markdownTemplateEngine: 'njk',
  };
};
