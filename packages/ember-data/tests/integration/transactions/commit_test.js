var get = Ember.get, set = Ember.set;

var adapter, store, serializer, ajaxResults, ajaxCalls, promises, idCounter;
var Adapter, Post, Comment;

var TestAdapter = DS.RESTAdapter.extend({

  ajax: function(url, type, hash) {
    var self = this;
    var promise = new Ember.RSVP.Promise(function(resolve, reject){

      var result = ajaxResults[type + ":" + url]();
      var json = result['json'];
      var error = result['error'];
      ajaxCalls.push(type + ":" + url);

      Ember.run.later(function() {
        if(error) {
          reject(error);
        } else {
          resolve(json);
        }
      }, 0);
    });

    promises.push(promise);

    return promise;
  }

});

module("Transaction commit", {
  setup: function() {
    promises = [];
    ajaxResults = {};
    ajaxCalls = [];
    idCounter = 1;
    Adapter = TestAdapter.extend();

    Post = DS.Model.extend({});
    Post.toString = function() {
      return "App.Post";
    };

    Comment = DS.Model.extend();
    Comment.toString = function() {
      return "App.Comment";
    };

    Comment.reopen({
      body: DS.attr('string'),
      post: DS.belongsTo(Post)
    });

    Post.reopen({
      title: DS.attr('string'),
      comments: DS.hasMany(Comment),
    });

    Adapter.map(Post, {
      tags: { embedded: 'always' }
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
  }
});

asyncTest('transaction with new record that fails can be retried', function() {

  var transaction = store.transaction();

  var post = transaction.createRecord(Post, {title: ""});

  equal(get(transaction, 'isPending'), false);
  equal(get(transaction, 'isError'), false);
  equal(get(transaction, 'isCompleted'), false);

  ok(get(post, 'isDirty'));
  ok(get(post, 'isNew'));

  ajaxResults['POST:/posts'] = function() { return {error: {status: 422, responseText: '{"errors": {}}'}}; };

  var promise = transaction.commit();

  equal(get(transaction, 'isPending'), true);

  promise.then(null, function() {
    equal(get(transaction, 'isPending'), false);
    equal(get(transaction, 'isError'), true);
    equal(get(transaction, 'isCompleted'), false);

    ok(!get(post, 'isValid'));

    set(post, 'title', 'fixed title');
    ajaxResults['POST:/posts'] = function() { return {json: {post: {title: 'fixed title', id: 1}}}; };

    var promise = transaction.commit();

    equal(get(transaction, 'isPending'), true);

    promise.then(function() {
      equal(get(transaction, 'isPending'), false);
      equal(get(transaction, 'isError'), false);
      equal(get(transaction, 'isCompleted'), true);

      ok(!get(post, 'isDirty'));
      ok(!get(post, 'isSaving'));
      ok(get(post, 'isValid'));

      start();
    });
  });

});

asyncTest('transaction with updated record that fails can be retried', function() {

  var transaction = store.transaction();

  store.load(Post, {id: 1, title: "title"});
  var post = store.find(Post, 1);

  transaction.add(post);

  equal(get(transaction, 'isPending'), false);
  equal(get(transaction, 'isError'), false);
  equal(get(transaction, 'isCompleted'), false);

  set(post, 'title', '');

  ok(get(post, 'isDirty'));
  ok(!get(post, 'isNew'));

  ajaxResults['PUT:/posts/1'] = function() { return {error: {status: 422, responseText: '{"errors": {}}'}}; };

  var promise = transaction.commit();

  equal(get(transaction, 'isPending'), true);

  promise.then(null, function() {
    equal(get(transaction, 'isPending'), false);
    equal(get(transaction, 'isError'), true);
    equal(get(transaction, 'isCompleted'), false);

    ok(!get(post, 'isValid'));

    set(post, 'title', 'fixed title');
    ajaxResults['PUT:/posts/1'] = function() { return {json: {post: {title: 'fixed title', id: 1}}}; };

    var promise = transaction.commit();

    equal(get(transaction, 'isPending'), true);

    promise.then(function() {
      equal(get(transaction, 'isPending'), false);
      equal(get(transaction, 'isError'), false);
      equal(get(transaction, 'isCompleted'), true);

      ok(!get(post, 'isDirty'));
      ok(!get(post, 'isSaving'));
      ok(get(post, 'isValid'));

      start();
    });
  });

});