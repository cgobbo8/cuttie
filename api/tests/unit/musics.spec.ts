import { test } from '@japa/runner'
import { musicFrom, parseUniverses, soundsLike } from '#services/musics'

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

test.group('the sounds of a game', () => {
  test('a track goes with a game when the streamer says so; when they said nothing, when its name does', ({ assert }) => {
    // By its name: a theme of the game; the track that ships and sounds like it
    assert.isTrue(soundsLike({ id: 'u1', name: 'GTA Vice City' }, 'gta'))
    assert.isTrue(soundsLike({ id: 'synthwave', name: 'Arcade Retro Nights' }, 'gta'))
    assert.isFalse(soundsLike({ id: 'u2', name: 'Flower In A Hurricane' }, 'gta'))
    // The streamer's word comes first, either way
    assert.isTrue(soundsLike({ id: 'u2', name: 'Flower In A Hurricane', universes: ['gta'] }, 'gta'))
    assert.isFalse(soundsLike({ id: 'u1', name: 'GTA Vice City', universes: [] }, 'gta'))
    // A video in the channel's own look, or a look nobody knows: no track is set apart
    assert.isFalse(soundsLike({ id: 'u1', name: 'GTA Vice City' }, undefined))
    assert.isFalse(soundsLike({ id: 'u1', name: 'GTA Vice City' }, 'zelda'))
    // Only looks the app has, each once
    assert.deepEqual(parseUniverses(['gta', 'zelda', 'gta', 3]), ['gta'])
    assert.deepEqual(parseUniverses('gta'), [])
  })
})
