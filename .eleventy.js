const { DateTime } = require("luxon");

module.exports = function (eleventyConfig) {
  // Pass through static assets
  eleventyConfig.addPassthroughCopy("src/css");
  eleventyConfig.addPassthroughCopy("src/js");
  eleventyConfig.addPassthroughCopy("src/images");
  eleventyConfig.addPassthroughCopy("src/admin");

  // Date filters
  eleventyConfig.addFilter("date", function (dateObj, format) {
    if (format === "YYYY-MM-DD") {
      return DateTime.fromJSDate(new Date(dateObj)).toFormat("yyyy-MM-dd");
    }
    if (format === "YYYY") {
      return DateTime.fromJSDate(new Date(dateObj)).toFormat("yyyy");
    }
    return DateTime.fromJSDate(new Date(dateObj)).toFormat(format || "LLLL d, yyyy");
  });

  // Truncate filter
  eleventyConfig.addFilter("truncate", function (str, len) {
    if (!str) return "";
    if (str.length <= len) return str;
    return str.substring(0, len) + "...";
  });

  // Strip HTML tags
  eleventyConfig.addFilter("striptags", function (str) {
    if (!str) return "";
    return str.replace(/<[^>]*>/g, "");
  });

  // Capitalize filter
  eleventyConfig.addFilter("capitalize", function (str) {
    if (!str) return "";
    return str.charAt(0).toUpperCase() + str.slice(1);
  });

  // Blog posts collection
  eleventyConfig.addCollection("posts", function (collectionApi) {
    return collectionApi.getFilteredByGlob("src/content/posts/*.md").sort(function (a, b) {
      return a.date - b.date;
    });
  });

  return {
    dir: {
      input: "src",
      output: "_site",
      includes: "_includes",
      data: "_data"
    },
    templateFormats: ["njk", "md", "html"],
    htmlTemplateEngine: "njk",
    markdownTemplateEngine: "njk"
  };
};