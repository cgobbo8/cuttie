import { test } from '@japa/runner'
import { musicFrom } from '#services/musics'

test.group('where a video starts reading a track', () => {
  test('before its strong moment when the track builds up to it and the video opens with an intro', ({ assert }) => {
    // A riff that comes in at 35.1 s after a long build: with an intro of 1.79 s (four beats), the track is read from 33.31 s
    const riff = { start: 35.1, build: true }
    assert.equal(musicFrom(riff, 1.79), 33.31)
    // A hook plays a moment of the video first: the track builds under it just the same
    assert.equal(musicFrom(riff, 4.2), 30.9)
    // No intro, or a track that doesn't build up: on the moment itself
    assert.deepEqual([musicFrom(riff, 0), musicFrom({ start: 35.1 }, 1.79), musicFrom({ start: 35.1, build: false }, 1.79)], [35.1, 35.1, 35.1])
    // A moment too near the start of the track to have that much before it: on the moment
    assert.equal(musicFrom({ start: 0.4, build: true }, 1.79), 0.4)
  })
})
