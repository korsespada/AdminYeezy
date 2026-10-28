import { describe, expect, it } from 'vitest'

const {
  canRemuxVideo,
  videoOutputArgs,
} = require('../../../scripts/lib/video-transcode')

const h264 = (overrides: Record<string, unknown> = {}) => ({
  codec_type: 'video',
  codec_name: 'h264',
  pix_fmt: 'yuv420p',
  width: 720,
  height: 1080,
  ...overrides,
})
const aac = { codec_type: 'audio', codec_name: 'aac' }
const probe = (streams: unknown[], bitRate = '2500000') => ({ streams, format: { bit_rate: bitRate } })

describe('video transcode for the storefront', () => {
  it('only repackages a video that already matches the web output', () => {
    expect(canRemuxVideo(probe([h264(), aac]))).toBe(true)
    expect(canRemuxVideo(probe([h264()]))).toBe(true)
  })

  it('re-encodes videos that differ from the web output', () => {
    expect(canRemuxVideo(probe([h264({ codec_name: 'hevc' }), aac]))).toBe(false)
    expect(canRemuxVideo(probe([h264({ pix_fmt: 'yuv420p10le' }), aac]))).toBe(false)
    expect(canRemuxVideo(probe([h264({ width: 1080, height: 1920 }), aac]))).toBe(false)
    expect(canRemuxVideo(probe([h264({ width: 719 }), aac]))).toBe(false)
    expect(canRemuxVideo(probe([h264({ side_data_list: [{ rotation: -90 }] }), aac]))).toBe(false)
    expect(canRemuxVideo(probe([h264(), { codec_type: 'audio', codec_name: 'opus' }]))).toBe(false)
    expect(canRemuxVideo(probe([h264({ disposition: { attached_pic: 1 } }), aac]))).toBe(false)
    expect(canRemuxVideo(probe([h264(), aac], '12000000'))).toBe(false)
    expect(canRemuxVideo(probe([h264(), aac], ''))).toBe(false)
    expect(canRemuxVideo(probe([aac]))).toBe(false)
  })

  it('copies streams for a remux and uses the fast x264 preset otherwise', () => {
    const remux = videoOutputArgs('in', 'out.mp4', true)
    expect(remux).toEqual(expect.arrayContaining(['-c', 'copy', '+faststart']))
    expect(remux).not.toContain('libx264')

    const transcode = videoOutputArgs('in', 'out.mp4', false)
    const preset = transcode.indexOf('-preset')
    expect(transcode.slice(preset, preset + 4)).toEqual(['-preset', 'veryfast', '-crf', '26'])
    expect(transcode).toEqual(expect.arrayContaining(['-map', '0:v:0', '0:a?', '+faststart']))
  })
})
