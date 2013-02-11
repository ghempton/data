var get = Ember.get, set = Ember.set;
/*global $*/

var adapter, store, serializer, ajaxResults, promises, idCounter;
var Post, Comment;

module("the Relational Adapter", {
  setup: function() {
    promises = [];
    ajaxResults = {};
    idCounter = 1;
    var Adapter = DS.RelationalAdapter.extend();

    adapter = DS.RelationalAdapter.create({
      ajax: function(url, type, hash) {
        var success = hash.success, self = this;
        var deferred = $.Deferred();

        var json = ajaxResults[url]();
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

asyncTest("children should wait for their parents to be saved", function () {
  var post = store.createRecord(Post, {title: 'Who needs ACID??'});
  var comment = get(post, 'comments').createRecord({body: 'not me'});

  ajaxResults['/comments'] = function() { return dataForCreate(comment); };
  ajaxResults['/posts'] = function() { return dataForCreate(post); };

  store.commit();

  waitForPromises(function() {
    equal(get(comment, 'post'), post, "post should be set");
  });
});