/*
 * Decode one still HEVC-backed HEIF primary image into bounded RGB pixels.
 *
 * This wrapper intentionally exposes no encoding API. It is dynamically linked
 * to the vendored LGPL libheif/libde265 libraries so deployments can replace
 * those libraries with ABI-compatible builds.
 */
#include <errno.h>
#include <inttypes.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>

#include <libde265/de265.h>
#include <libheif/heif.h>
#include <libheif/heif_sequences.h>

#define MAX_INPUT_BYTES (15U * 1024U * 1024U)
#define MAX_IMAGE_PIXELS UINT64_C(40000000)
#define MAX_TOTAL_MEMORY UINT64_C(402653184)
#define MAX_MEMORY_BLOCK UINT64_C(201326592)
#define MAX_EXIF_BYTES (1024U * 1024U)

static int fail(const char* message)
{
  fprintf(stderr, "%s\n", message);
  return 1;
}

static int fail_heif(const char* prefix, struct heif_error error)
{
  fprintf(stderr, "%s: %s\n", prefix, error.message ? error.message : "decoder error");
  return 1;
}

static int write_bytes(const char* path, const uint8_t* data, size_t size)
{
  FILE* output = fopen(path, "wb");
  if (!output) {
    return fail("Could not create decoder output.");
  }

  size_t written = fwrite(data, 1, size, output);
  int close_error = fclose(output);
  if (written != size || close_error != 0) {
    return fail("Could not write complete decoder output.");
  }

  return 0;
}

static int copy_rgb_rows(const char* path, const struct heif_image* image, int width, int height)
{
  size_t stride = 0;
  const uint8_t* plane =
    heif_image_get_plane_readonly2(image, heif_channel_interleaved, &stride);
  size_t row_bytes = (size_t)width * 3U;
  if (!plane || stride < row_bytes) {
    return fail("Decoder returned an invalid RGB plane.");
  }

  FILE* output = fopen(path, "wb");
  if (!output) {
    return fail("Could not create RGB output.");
  }

  for (int row = 0; row < height; row++) {
    if (fwrite(plane + ((size_t)row * stride), 1, row_bytes, output) != row_bytes) {
      fclose(output);
      return fail("Could not write complete RGB output.");
    }
  }

  if (fclose(output) != 0) {
    return fail("Could not close RGB output.");
  }

  return 0;
}

static int write_exif(const char* path, const struct heif_image_handle* handle, size_t* size_out)
{
  *size_out = 0;
  int count = heif_image_handle_get_number_of_metadata_blocks(handle, "Exif");
  if (count < 0 || count > 1) {
    return fail("HEIF contains an unsupported number of EXIF blocks.");
  }
  if (count == 0) {
    return write_bytes(path, NULL, 0);
  }

  heif_item_id metadata_id = 0;
  if (heif_image_handle_get_list_of_metadata_block_IDs(handle, "Exif", &metadata_id, 1) != 1) {
    return fail("Could not select HEIF EXIF metadata.");
  }

  size_t stored_size = heif_image_handle_get_metadata_size(handle, metadata_id);
  if (stored_size < 4 || stored_size > MAX_EXIF_BYTES) {
    return fail("HEIF EXIF metadata has an invalid size.");
  }

  uint8_t* stored = malloc(stored_size);
  if (!stored) {
    return fail("Could not allocate bounded EXIF storage.");
  }

  struct heif_error error = heif_image_handle_get_metadata(handle, metadata_id, stored);
  if (error.code != heif_error_Ok) {
    free(stored);
    return fail_heif("Could not read HEIF EXIF metadata", error);
  }

  uint32_t offset = ((uint32_t)stored[0] << 24U) | ((uint32_t)stored[1] << 16U) |
                    ((uint32_t)stored[2] << 8U) | (uint32_t)stored[3];
  uint64_t tiff_offset = (uint64_t)offset + 4U;
  if (tiff_offset >= stored_size) {
    free(stored);
    return fail("HEIF EXIF metadata has an invalid TIFF offset.");
  }

  size_t tiff_size = stored_size - (size_t)tiff_offset;
  int result = write_bytes(path, stored + tiff_offset, tiff_size);
  free(stored);
  if (result == 0) {
    *size_out = tiff_size;
  }
  return result;
}

int main(int argc, char** argv)
{
  if (argc != 4) {
    return fail("Usage: heic-intake-decoder INPUT RGB_OUTPUT EXIF_OUTPUT");
  }

  struct stat input_stat;
  if (stat(argv[1], &input_stat) != 0 || input_stat.st_size <= 0 ||
      (uint64_t)input_stat.st_size > MAX_INPUT_BYTES) {
    return fail("HEIF input size is outside the intake limit.");
  }

  struct heif_error error = heif_init(NULL);
  if (error.code != heif_error_Ok) {
    return fail_heif("Could not initialize HEIF decoder", error);
  }

  int result = 1;
  struct heif_context* context = heif_context_alloc();
  struct heif_image_handle* handle = NULL;
  struct heif_decoding_options* options = NULL;
  struct heif_image* image = NULL;

  if (!context) {
    fail("Could not allocate HEIF decoder context.");
    goto cleanup;
  }

  struct heif_security_limits* limits = heif_context_get_security_limits(context);
  if (!limits) {
    fail("HEIF decoder security limits are unavailable.");
    goto cleanup;
  }
  limits->max_image_size_pixels = MAX_IMAGE_PIXELS;
  if (limits->max_total_memory == 0 || limits->max_total_memory > MAX_TOTAL_MEMORY) {
    limits->max_total_memory = MAX_TOTAL_MEMORY;
  }
  if (limits->max_memory_block_size == 0 || limits->max_memory_block_size > MAX_MEMORY_BLOCK) {
    limits->max_memory_block_size = MAX_MEMORY_BLOCK;
  }
  heif_context_set_max_decoding_threads(context, 2);

  error = heif_context_read_from_file(context, argv[1], NULL);
  if (error.code != heif_error_Ok) {
    fail_heif("Could not parse HEIF container", error);
    goto cleanup;
  }

  if (heif_context_has_sequence(context)) {
    fail("Timed HEIF sequences and videos are not supported.");
    goto cleanup;
  }
  if (heif_context_get_number_of_top_level_images(context) != 1) {
    fail("HEIF collections and multi-image sequences are not supported.");
    goto cleanup;
  }
  if (!heif_have_decoder_for_format(heif_compression_HEVC)) {
    fail("The packaged decoder does not provide HEVC support.");
    goto cleanup;
  }

  error = heif_context_get_primary_image_handle(context, &handle);
  if (error.code != heif_error_Ok || !handle) {
    fail_heif("Could not select the primary HEIF image", error);
    goto cleanup;
  }

  int width = heif_image_handle_get_width(handle);
  int height = heif_image_handle_get_height(handle);
  if (width <= 0 || height <= 0 ||
      (uint64_t)width * (uint64_t)height > MAX_IMAGE_PIXELS) {
    fail("HEIF image dimensions exceed the 40-megapixel limit.");
    goto cleanup;
  }

  options = heif_decoding_options_alloc();
  if (!options) {
    fail("Could not allocate HEIF decoding options.");
    goto cleanup;
  }
  options->ignore_transformations = 0;
  options->convert_hdr_to_8bit = 1;
  options->strict_decoding = 1;
  options->num_codec_threads = 2;
  options->autocorrect_broken_input = 0;
  options->output_image_nclx_profile_passthrough = 0;

  error = heif_decode_image(
    handle, &image, heif_colorspace_RGB, heif_chroma_interleaved_RGB, options);
  if (error.code != heif_error_Ok || !image) {
    fail_heif("Could not decode primary HEVC image", error);
    goto cleanup;
  }

  struct heif_error warning;
  if (heif_image_get_decoding_warnings(image, 0, &warning, 1) != 0) {
    fail("HEIF decoding produced a warning and was rejected.");
    goto cleanup;
  }

  int decoded_width = heif_image_get_primary_width(image);
  int decoded_height = heif_image_get_primary_height(image);
  if (decoded_width <= 0 || decoded_height <= 0 ||
      (uint64_t)decoded_width * (uint64_t)decoded_height > MAX_IMAGE_PIXELS) {
    fail("Decoded HEIF dimensions exceed the 40-megapixel limit.");
    goto cleanup;
  }

  if (copy_rgb_rows(argv[2], image, decoded_width, decoded_height) != 0) {
    goto cleanup;
  }

  size_t exif_size = 0;
  if (write_exif(argv[3], handle, &exif_size) != 0) {
    goto cleanup;
  }

  int auxiliary_count = heif_image_handle_get_number_of_auxiliary_images(handle, 0);
  int has_depth = heif_image_handle_has_depth_image(handle);
  printf(
    "{\"width\":%d,\"height\":%d,\"channels\":3,\"exifBytes\":%zu,"
    "\"auxiliaryImages\":%d,\"hasDepth\":%s,\"libheif\":\"%s\","
    "\"libde265\":\"%s\"}\n",
    decoded_width,
    decoded_height,
    exif_size,
    auxiliary_count < 0 ? 0 : auxiliary_count,
    has_depth ? "true" : "false",
    heif_get_version(),
    de265_get_version());
  result = 0;

cleanup:
  if (image) heif_image_release(image);
  if (options) heif_decoding_options_free(options);
  if (handle) heif_image_handle_release(handle);
  if (context) heif_context_free(context);
  heif_deinit();
  return result;
}
