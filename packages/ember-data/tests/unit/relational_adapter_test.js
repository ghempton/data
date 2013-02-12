var get = Ember.get, set = Ember.set;
/*global $*/

var adapter, Adapter, store, serializer, ajaxResults, ajaxCalls, promises, idCounter;
var Post, Comment;

module("the Relational Adapter", {
  setup: function() {
    promises = [];
    ajaxResults = {};
    ajaxCalls = [];
    idCounter = 1;
    Adapter = DS.RelationalAdapter.extend();

    adapter = DS.RelationalAdapter.create({
      ajax: function(url, type, hash) {
        var success = hash.success, self = this;
        var deferred = $.Deferred();

        var json = ajaxResults[type + ":" + url]();
        ajaxCalls.push(type + ":" + url);
        setTimeout(function() {
          success.call(self, json);
          deferred.resolve();
        });

        var promise = deferred.promise();
        promises.push(promise);

        return promise;
      }
    });

    serializer = get(adapter, 'serializer');

    store = DS.Store.create({
      adapter: adapter
    });

    Post = DS.Model.extend();

    Comment = DS.Model.extend({
      body: DS.attr('string'),
      post: DS.belongsTo(Post)
    });

    Comment.toString = function() {
      return "App.Comment";
    };

    Post.reopen({
      title: DS.attr('string'),
      comments: DS.hasMany(Comment)
    });

    Post.toString = function() {
      return "App.Post";
    };
  },

  teardown: function() {
    adapter.destroy();
    store.destroy();
    ajaxResults = undefined;
    ajaxCalls = undefined;
    promises = undefined;
    idCounter = undefined;
  }
});

function waitForPromises(callback) {
  $.when.apply($, promises).then(function() {
    if(callback) { callback.call(this); }
    start();
  });
}

function dataForCreate(record) {
  var root = adapter.rootForType(record.constructor);
  var data = adapter.serialize(record, { includeId: true });
  data.id = idCounter++;
  var result = {};
  result[root] = data;
  return result;
}

asyncTest("creating parent->child hierarchy", function () {
  var post = store.createRecord(Post, {title: 'Who needs ACID??'});
  var comment = get(post, 'comments').createRecord({body: 'not me'});

  ajaxResults = {
    'POST:/comments': function() { return dataForCreate(comment); },
    'POST:/posts': function() { return dataForCreate(post); }
  };

  store.commit();

  waitForPromises(function() {
    equal(get(comment, 'post'), post, "post should be set");
  });
});

asyncTest("deleting child", function () {
  adapter.load(store, Post, {id: 1, title: 'Who needs ACID??', comments: [2]});
  adapter.load(store, Comment, {id: 2, title: 'not me', post_id: 1});

  var post = store.find(Post, 1);
  var comment = store.find(Comment, 2);

  comment.deleteRecord();

  var deleteHit = false;
  ajaxResults = {
    'DELETE:/comments/2': function() { deleteHit = true; return {}; }
  };

  store.commit();

  waitForPromises(function() {
    ok(deleteHit, "comment should have received a DELETE request");
    equal(get(post, 'comments.length'), 0, 'post should not have any comments');
  });
});

asyncTest("deleting child and updating parent", function () {
  adapter.load(store, Post, {id: 1, title: 'Who needs ACID??', comments: [2]});
  adapter.load(store, Comment, {id: 2, title: 'not me', post_id: 1});

  var post = store.find(Post, 1);
  var comment = store.find(Comment, 2);

  set(post, 'title', 'Who ALWAYS needs ACID?');
  comment.deleteRecord();

  ajaxResults = {
    'DELETE:/comments/2': function() { return {}; },
    'PUT:/posts/1': function() { return {post: {id: 1, title: 'Who ALWAYS needs ACID?'}}; }
  };

  store.commit();

  waitForPromises(function() {
    deepEqual(ajaxCalls, ['DELETE:/comments/2', 'PUT:/posts/1'], "parent should have been updated first");
    equal(get(post, 'comments.length'), 0, 'post should not have any comments');
  });
});

// TODO Embedded records