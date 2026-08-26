FROM amazonlinux:2023 AS builder

ARG LIBHEIF_COMMIT=2c4bbb54c2738d4a5efbbe3e5fa1d5d76bb88eb0
ARG LIBDE265_COMMIT=4dd701fffac01632ffd5cabc5ef10deb56accba1

RUN dnf install -y cmake gcc gcc-c++ git ninja-build pkgconf-pkg-config && dnf clean all

WORKDIR /src
RUN git clone --filter=blob:none https://github.com/strukturag/libde265.git && \
    git -C libde265 checkout "$LIBDE265_COMMIT" && \
    test "$(git -C libde265 rev-parse HEAD)" = "$LIBDE265_COMMIT"
RUN cmake -S libde265 -B libde265-build -G Ninja \
      -DCMAKE_BUILD_TYPE=Release \
      -DCMAKE_INSTALL_PREFIX=/opt/heic \
      -DCMAKE_INSTALL_LIBDIR=lib \
      -DBUILD_SHARED_LIBS=ON \
      -DENABLE_DECODER=ON \
      -DENABLE_ENCODER=OFF \
      -DENABLE_SDL=OFF \
      -DENABLE_AVX512=OFF && \
    cmake --build libde265-build && cmake --install libde265-build

RUN git clone --filter=blob:none https://github.com/strukturag/libheif.git && \
    git -C libheif checkout "$LIBHEIF_COMMIT" && \
    test "$(git -C libheif rev-parse HEAD)" = "$LIBHEIF_COMMIT"
RUN PKG_CONFIG_PATH=/opt/heic/lib/pkgconfig cmake -S libheif -B libheif-build -G Ninja \
      -DCMAKE_BUILD_TYPE=Release \
      -DCMAKE_INSTALL_PREFIX=/opt/heic \
      -DCMAKE_INSTALL_LIBDIR=lib \
      -DCMAKE_INSTALL_RPATH=\$ORIGIN \
      -DBUILD_SHARED_LIBS=ON \
      -DBUILD_TESTING=OFF \
      -DBUILD_DOCUMENTATION=OFF \
      -DWITH_EXAMPLES=OFF \
      -DWITH_EXAMPLE_HEIF_THUMB=OFF \
      -DWITH_EXAMPLE_HEIF_VIEW=OFF \
      -DWITH_GDK_PIXBUF=OFF \
      -DENABLE_PLUGIN_LOADING=OFF \
      -DWITH_LIBDE265=ON \
      -DWITH_X265=OFF \
      -DWITH_KVAZAAR=OFF \
      -DWITH_UVG266=OFF \
      -DWITH_VVDEC=OFF \
      -DWITH_VVENC=OFF \
      -DWITH_X264=OFF \
      -DWITH_OpenH264_DECODER=OFF \
      -DWITH_DAV1D=OFF \
      -DWITH_AOM_DECODER=OFF \
      -DWITH_AOM_ENCODER=OFF \
      -DWITH_SvtEnc=OFF \
      -DWITH_RAV1E=OFF \
      -DWITH_JPEG_DECODER=OFF \
      -DWITH_JPEG_ENCODER=OFF \
      -DWITH_OpenJPEG_ENCODER=OFF \
      -DWITH_OpenJPEG_DECODER=OFF \
      -DWITH_FFMPEG_DECODER=OFF \
      -DWITH_OPENJPH_ENCODER=OFF \
      -DWITH_UNCOMPRESSED_CODEC=OFF \
      -DWITH_LIBSHARPYUV=OFF && \
    cmake --build libheif-build && cmake --install libheif-build

COPY heic-intake-decoder.c /src/heic-intake-decoder.c
RUN PKG_CONFIG_PATH=/opt/heic/lib/pkgconfig gcc -O2 -Wall -Wextra -Werror \
      /src/heic-intake-decoder.c -o /opt/heic/heic-intake-decoder \
      $(PKG_CONFIG_PATH=/opt/heic/lib/pkgconfig pkg-config --cflags --libs libheif libde265) \
      -Wl,-rpath,'$ORIGIN/../lib' && \
    test "$(LD_LIBRARY_PATH=/opt/heic/lib /opt/heic/heic-intake-decoder 2>&1 || true)" = \
      "Usage: heic-intake-decoder INPUT RGB_OUTPUT EXIF_OUTPUT"

FROM amazonlinux:2023
COPY --from=builder /opt/heic/heic-intake-decoder /artifact/bin/heic-intake-decoder
COPY --from=builder /opt/heic/lib/libheif.so.1 /artifact/lib/libheif.so.1
COPY --from=builder /opt/heic/lib/libde265.so.0 /artifact/lib/libde265.so.0
COPY --from=builder /src/libheif/COPYING /artifact/licenses/libheif-COPYING
COPY --from=builder /src/libde265/COPYING /artifact/licenses/libde265-COPYING
CMD ["cp", "-a", "/artifact/.", "/out/"]
