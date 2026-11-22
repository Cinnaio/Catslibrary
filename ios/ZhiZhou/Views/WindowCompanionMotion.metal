#include <metal_stdlib>
using namespace metal;

static float motionArea(float2 point, float2 center, float2 radius) {
    return 1.0f - smoothstep(0.12f, 1.0f, length((point - center) / radius));
}

// Each tip settles into the unchanged ear root. Face and torso pixels retain their source position.
[[stitchable]] float2 windowCompanionMotion(float2 position, float2 size, float flick) {
    constexpr float2 artworkSize(1086.0f, 1448.0f);
    float2 pixel = position * artworkSize / max(size, float2(1.0f));
    float frontEar = motionArea(pixel, float2(273.0f, 259.0f), float2(152.0f, 96.0f));
    float backEar = motionArea(pixel, float2(714.0f, 20.0f), float2(103.0f, 123.0f));
    float strand = motionArea(pixel, float2(915.0f, 783.0f), float2(54.0f, 106.0f));

    float2 offset = frontEar * float2(11.0f, 8.0f)
                  + backEar * float2(-16.0f, 7.0f)
                  + strand * float2(5.0f, 2.0f);
    return position - clamp(flick, -0.3f, 1.05f) * offset * size / artworkSize;
}
