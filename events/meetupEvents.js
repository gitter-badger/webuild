'use strict';

var querystring = require('querystring'),
  prequest = require('prequest'),
  utils = require('./utils'),
  config = require('./config');

function constructAddress(venue) {
  var address = '';

  if (venue) {
    address = [
      venue.name,
      ', ',
      venue.address_1 || '',
      (venue.address_2 ? ', ' + venue.address_2 : '')
    ].join('');
    address += address.indexOf(config.meetupParams.city) === -1 ? ', ' + config.meetupParams.city : '';
  } else {
    address = config.meetupParams.city;
  }

  return address;
}

function isValidGroup(row) {
  var blacklistGroups = config.blacklistGroups || [],
    blacklistWords = config.blacklistWords || [],
    blacklistRE = new RegExp(blacklistWords.join('|'), 'i'),
    isValidCountry = row.country === (config.meetupParams.country || row.country),
    isValidText = blacklistWords.length === 0 ? true : !(row.name.match(blacklistRE) || row.description.match(blacklistRE)),
    isValidGroupId = !blacklistGroups.some(function(id) { return row.id === id });

  return isValidCountry && isValidText && isValidGroupId;
}

function normalizeCommunityEvents(events, row) {
  var eventTime,
    event = {};

  if (!(row.time && row.venue_name)) {
    return events;
  }

  eventTime = utils.localTime(row.time);
  row.name = row.venue_name;
  row.address_1 = row.address1 || '';

  event = {
    id: row.id.toString(),
    name: row.short_description,
    description: utils.htmlStrip(row.description),
    location: constructAddress(row),
    url: row.meetup_url,
    group_name: row.container.name + ' Community',
    group_url: 'http://meetup.com/' + row.container.urlname + '/' + row.community.urlname,
    formatted_time: utils.formatLocalTime(row.time),
    start_time: eventTime.toISOString(),
    end_time: eventTime.add(7200000, 'milliseconds').toISOString()
  }
  events.push(event);

  return events;
}

function normalizeGroupEvents(events, row) {
  var eventTime,
      event = {};

  if (!row.hasOwnProperty('venue') || row.venue_visibility === 'members') {
    return events;
  }

  if (row.duration === undefined) {
    row.duration = 7200000
  }

  eventTime = utils.localTime(row.time);

  event = {
    id: row.id,
    name: row.name,
    description: utils.htmlStrip(row.description),
    location: constructAddress(row.venue),
    url: row.event_url,
    group_name: row.group.name,
    group_url: 'http://meetup.com/' + row.group.urlname,
    formatted_time: utils.formatLocalTime(row.time),
    start_time: eventTime.toISOString(),
    end_time: eventTime.add(row.duration, 'milliseconds').toISOString()
  }

  events.push(event);
  return events;
}

// getEventsByGroupIds returns an array of events
// for the provided groups.
function getEventsByGroupIds(groupIds) {
  var url = 'https://api.meetup.com/2/events/?' +
  querystring.stringify({
    key: config.meetupParams.key,
    group_id: groupIds.join(',')
  });

  return prequest(url).then(function(data) {
    var events = [];
    data.results.reduce(normalizeGroupEvents, events);
    console.log(events.length + ' Meetup group events with venues');
    return events;
  }).catch(function(err) {
    console.error('Error getEventsByGroupIds(): ' + err);
  });
}

// getGroupIds returns an array of group IDs
// matching the given criteria.
function getGroupIds() { //regardless of venue
  var url = 'https://api.meetup.com/2/groups?' +
    querystring.stringify(config.meetupParams);

  return prequest(url).then(function(data) {
    console.log('Fetched ' + data.results.length + ' Meetup groups');
    return data.results
      .filter(isValidGroup)
      .reduce(function(groupIds, row) {
        groupIds.push(row.id);
        return groupIds;
      }, []);
  }).catch(function(err) {
    console.error('Error getGroupIds(): ' + err);
  });
}

function getCommunityEvents() {
  var url = 'https://api.meetup.com/ew/events?' +
    querystring.stringify({
      key: config.meetupParams.key,
      country: config.meetupParams.country,
      city: config.meetupParams.city,
      urlname: config.meetupCommunities.join(','),
      after: '0d'
    });

  return prequest(url).then(function(data) {
    var events = [];

    console.log(data.results.length + ' Meetup community events with venues');
    data.results.reduce(normalizeCommunityEvents, events);
    return events;
  }).catch(function(err) {
    console.error('Error getCommunityEvents(): ' + err);
  });
}

function getGroupEvents() {
  return getGroupIds()
    .then(function(groupIds) {
      return getEventsByGroupIds(groupIds);
    })
    .catch(function(err) {
      console.error('Error getGroupEvents(): ' + err);
    });
}

function getMeetupEvents() {
  return utils.waitAllPromises([ getGroupEvents(), getCommunityEvents() ])
    .then(function(events) {
      // events is a nested array of group and community events ([ [], [] ])
      // lets concat them before returning.
      return Array.prototype.concat.apply([], events);
    })
    .catch(function(err) {
      console.error('Error getMeetupEvents(): ' + err);
    });
}

exports.get = getMeetupEvents;
