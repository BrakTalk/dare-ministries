require('dotenv').config();
const { DateTime } = require('luxon');
const markdownIt = require('markdown-it');

// html: false — field note authors share one admin password, so raw HTML in
// entry bodies must never reach the public site.
const md = markdownIt({ html: false, linkify: true });

module.exports = function (eleventyConfig) {
  // Pass through static assets
  eleventyConfig.addPassthroughCopy('src/css');
  eleventyConfig.addPassthroughCopy('src/js');
  eleventyConfig.addPassthroughCopy('src/images');

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
