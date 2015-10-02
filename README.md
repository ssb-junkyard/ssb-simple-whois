# SSB Example Whois

Example program to lookup petname mappings in ssb

```
$ git clone https://github.com/pfraze/ssb-example-whois.git
$ cd ssb-example-whois
$ npm install

$ ./ssb-example-whois.js
   paul *** @hxGxqPrplLjRG2vtjQL87abX4QKqeLgCwQpS730nNwE=.ed25519
Dominic **  @BIbVppzlrNiRJogxDYz3glUS7G4s4D4NiXiPEAEzxdE=.ed25519
    bob *   @HSZ7V+Hrm0mbqNGkINtN1CL8VEsY1CDMBu5yPCHg5zI=.ed25519
    bob *   @PgeunKGJm05DZ0WWoRtGvH37gXMbDnVuse9HhaUT6RI=.ed25519

$ ./ssb-example-whois.js paul
paul *** @hxGxqPrplLjRG2vtjQL87abX4QKqeLgCwQpS730nNwE=.ed25519

$ ./ssb-example-whois.js bob
bob *   @HSZ7V+Hrm0mbqNGkINtN1CL8VEsY1CDMBu5yPCHg5zI=.ed25519
bob *   @PgeunKGJm05DZ0WWoRtGvH37gXMbDnVuse9HhaUT6RI=.ed25519
```

The stars indicate the amount of trust in the assignment.
- Three stars is full trust, because it's the name chosen by the local user.
- Two stars is partial trust, because it's the name chosen by someone the local user follows.
- One star is little trust, because it's the name chosen by an unfollowed user.

There are no universal rules for petnames in SSB.
There is no single registry or authority, so you can choose your own policies and algorithms.

## How it works

Users publish a `type: about` message, which has the following schema:

```js
{
  type: 'about',
  about: FeedLink,
  name: String
}
```

This program uses a very simple set of rules for computing the petname map.
Only self-assigned names are used.
The trust ranking is described above.

The petname map is a "materialized view," in the [Kappa Architecture](http://www.kappa-architecture.com/) semantic.
It is created by streaming `type: about` messages, in the order received, into a view-processing function.
The output is then produced from the map.

The streaming code:

```js
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

      // ... render ...
    })
  )
})
```

The processing function:

```js
// `type: about` message processor
// - expected schema: { type: 'about', name: String, about: FeedLink }
function processAboutMsg (msg) {
  var c = msg.value.content

  // sanity check
  if (!nonEmptyStr(c.name))
    return

  // only process self-assignments
  var link = mlib.link(msg.value.content.about, 'feed')
  if (link.link !== msg.value.author)
    return

  // remove any past assignments by this user
  for (var k in _names)
    _names[k] = _names[k].filter(function (entry) { return entry.id !== link.link })

  // store the new assignment
  var name = makeNameSafe(c.name)
  _names[name] = _names[name] || []
  _names[name].push({
    id:    link.link,
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
```