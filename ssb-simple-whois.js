#! /usr/bin/env node

var pull = require('pull-stream')
var mlib = require('ssb-msgs')
var multicb = require('multicb')
var argv = require('minimist')(process.argv.slice(2))

var _selfId = null
var _follows = null
var _names  = {}

require('ssb-client')(function (err, sbot) {
  if (err) throw err

  // fetch...
  var done = multicb({ pluck: 1, spread: true })
  sbot.whoami(done()) // ...local users id
  sbot.friends.all('follow', done()) // ...computed follow-graph
  done(function (err, whoami, follows) {
    if (err) throw err

    // store in globals
    _selfId = whoami.id
    _follows = follows

    pull(
      // fetch `type: about` messages, in order received
      sbot.messagesByType('about'),

      // process each message
      pull.drain(processAboutMsg, function (err) {
        if (err) throw err

        // render requested name or all names
        var nameArg = argv._[0]
        if (!nameArg)
          renderNames()
        else
          renderName(_names[nameArg] || [])

        sbot.close()
      })
    )
  })
})

// `type: about` message processor
// - expected schema: { type: 'about', name: String, about: FeedLink }
function processAboutMsg (msg) {
  var c = msg.value.content

  // sanity check
  if (!nonEmptyStr(c.name))
    return

  // only process self-assignments
  var target = mlib.link(c.about, 'feed')
  if (!target || target.link !== msg.value.author)
    return

  // remove any past assignments by this user
  for (var k in _names)
    _names[k] = _names[k].filter(function (entry) { return entry.id !== target.link })

  // store the new assignment
  var name = makeNameSafe(c.name)
  _names[name] = _names[name] || []
  _names[name].push({
    id:    target.link,
    name:  name,
    trust: rateTrust(msg)
  })
}

// trust-policy
function rateTrust (msg) {
  // is local user: high trust
  if (msg.value.author === _selfId)
    return 3
  // followed by local user: medium trust
  if (_follows[_selfId][msg.value.author])
    return 2
  // otherwise: low trust
  return 1
}

function renderNames () {
  // determine the longest name
  var width = 0
  for (var k in _names)
    width = (k.length > width) ? k.length : width

  // render all
  for (var k in _names)
    renderName(_names[k], width)
}

function renderName (list, width) {
  list.forEach(function (entry) {
    console.log(padLeft(entry.name, width, ' '), toStars(entry.trust), entry.id)
  })
}

function padLeft (str, width, pad) {
  if (!width)
    return str
  return Array(width + 1 - str.length).join(pad) + str
}

function toStars (v) {
  return ({ 1: '*  ', 2: '** ', 3: '***' })[v]
}

function nonEmptyStr (str) {
  return (typeof str === 'string' && !!(''+str).trim())
}

// allow A-z0-9._-, dont allow a trailing .
var badNameCharsRegex = /[^A-z0-9\._-]/g
function makeNameSafe (str) {
  str = str.replace(badNameCharsRegex, '_')
  if (str.charAt(str.length - 1) == '.')
    str = str.slice(0, -1) + '_'
  return str
}
