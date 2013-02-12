var get = Ember.get, set = Ember.set;
/*global $*/

var adapter, Adapter, store, serializer, ajaxResults, ajaxCalls, promises, idCounter;
var Post, Comment;

module("Relational Adapter", {
  setup: function() {
    promises = [];
    ajaxResults = {};
    ajaxCalls = [];
    idCounter = 1;
    Adapter = DS.RelationalAdapter.extend({
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

    adapter = Adapter.create();

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

function dataForRequest(record, props) {
  var root = adapter.rootForType(record.constructor);
  var data = adapter.serialize(record, { includeId: true });
  var result = {};
  result[root] = data;
  return result;
}

function dataForCreate(record) {
  return dataForRequest(record, {id: idCounter++});
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
    'DELETE:/comments/2': function() {},
    'PUT:/posts/1': function() { return {post: {id: 1, title: 'Who ALWAYS needs ACID?'}}; }
  };

  store.commit();

  waitForPromises(function() {
    deepEqual(ajaxCalls, ['DELETE:/comments/2', 'PUT:/posts/1'], 'comment should be deleted first');
    equal(get(post, 'comments.length'), 0, 'post should not have any comments');
  });
});

asyncTest("deleting child and parent", function () {
  adapter.load(store, Post, {id: 1, title: 'Who needs ACID??', comments: [2]});
  adapter.load(store, Comment, {id: 2, title: 'not me', post_id: 1});

  var post = store.find(Post, 1);
  var comment = store.find(Comment, 2);

  post.deleteRecord();
  comment.deleteRecord();

  var commentDelete = false;
  var postDelete = false;
  ajaxResults = {
    'DELETE:/comments/2': function() { commentDelete = true; },
    'DELETE:/posts/1': function() { postDelete = true; }
  };

  store.commit();

  waitForPromises(function() {
    ok(commentDelete, "comment should have received a DELETE request");
    ok(postDelete, "post should have received a DELETE request");
  });
});

module("Relational Adapter with embedded relationships", {
  setup: function() {
    promises = [];
    ajaxResults = {};
    ajaxCalls = [];
    idCounter = 1;
    Adapter = DS.RelationalAdapter.extend({
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

    Adapter.map(Post, {
      comments: { embedded: 'always' }
    });

    adapter = Adapter.create();

    serializer = get(adapter, 'serializer');

    store = DS.Store.create({
      adapter: adapter
    });
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

asyncTest("creating parent->child hierarchy", function() {
  var post = store.createRecord(Post, {title: 'Who needs ACID??'});
  var comment = get(post, 'comments').createRecord({body: 'not me'});

  ajaxResults = {
    'POST:/posts': function() { return dataForCreate(post); }
  };

  store.commit();

  waitForPromises(function() {
    equal(get(comment, 'post'), post, "post should be set");
  });
});

asyncTest("deleting child", function () {
  adapter.load(store, Post, {id: 1, title: 'Who needs ACID??', comments: [{id: 2, title: 'not me', post_id: 1}]});

  var post = store.find(Post, 1);
  var comment = store.find(Comment, 2);

  comment.deleteRecord();

  var deleteHit = false;
  ajaxResults = {
    'PUT:/posts/1': function() { return dataForRequest(post, {comments: []}); }
  };

  store.commit();

  waitForPromises(function() {
    deepEqual(ajaxCalls, ['PUT:/posts/1'], 'only the parent should be updated');
    equal(get(post, 'comments.length'), 0, 'post should not have any comments');
  });
});

asyncTest("deleting child and updating parent", function () {
  adapter.load(store, Post, {id: 1, title: 'Who needs ACID??', comments: [{id: 2, title: 'not me', post_id: 1}]});

  var post = store.find(Post, 1);
  var comment = store.find(Comment, 2);

  set(post, 'title', 'Who ALWAYS needs ACID?');
  comment.deleteRecord();

  ajaxResults = {
    'PUT:/posts/1': function() { return dataForRequest(post, {comments: []}); }
  };

  store.commit();

  waitForPromises(function() {
    deepEqual(ajaxCalls, ['PUT:/posts/1'], 'only the parent should be updated');
    equal(get(post, 'comments.length'), 0, 'post should not have any comments');
  });
});

asyncTest("deleting child and parent", function () {
  adapter.load(store, Post, {id: 1, title: 'Who needs ACID??', comments: [{id: 2, title: 'not me', post_id: 1}]});

  var post = store.find(Post, 1);
  var comment = store.find(Comment, 2);

  post.deleteRecord();
  comment.deleteRecord();

  ajaxResults = {
    'DELETE:/posts/1': function() {}
  };

  store.commit();

  waitForPromises(function() {
    deepEqual(ajaxCalls, ['DELETE:/posts/1'], 'only the parent should be deleted');
  });
});