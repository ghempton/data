require("ember-data/core");
require('ember-data/system/adapter');
require('ember-data/serializers/rest_serializer');
/*global jQuery*/

var get = Ember.get, set = Ember.set, merge = Ember.merge;

var Node = function(record, operation) {
  this.record = record;
  this.operation = operation;
  this.children = Ember.Set.create();
  this.parent = null;
};

Node.prototype = {
  addChild: function(childNode) {
    this.children.add(childNode);
    childNode.parent = this;
  }
};

/**
  The REST adapter allows your store to communicate with an HTTP server by
  transmitting JSON via XHR. Most Ember.js apps that consume a JSON API
  should use the REST adapter.

  This adapter is designed around the idea that the JSON exchanged with
  the server should be conventional.

  ## JSON Structure

  The REST adapter expects the JSON returned from your server to follow
  these conventions.

  ### Object Root

  The JSON payload should be an object that contains the record inside a
  root property. For example, in response to a `GET` request for
  `/posts/1`, the JSON should look like this:

  ```js
  {
    "post": {
      title: "I'm Running to Reform the W3C's Tag",
      author: "Yehuda Katz"
    }
  }
  ```

  ### Conventional Names

  Attribute names in your JSON payload should be the underscored versions of
  the attributes in your Ember.js models.

  For example, if you have a `Person` model:

  ```js
  App.Person = DS.Model.extend({
    firstName: DS.attr('string'),
    lastName: DS.attr('string'),
    occupation: DS.attr('string')
  });
  ```

  The JSON returned should look like this:

  ```js
  {
    "person": {
      "first_name": "Barack",
      "last_name": "Obama",
      "occupation": "President"
    }
  }
  ```
*/
DS.RESTAdapter = DS.Adapter.extend({
  bulkCommit: false,
  since: 'since',

  serializer: DS.RESTSerializer,

  init: function() {
    this._super.apply(this, arguments);
  },

  save: function(store, commitDetails) {
    if(get(this, 'bulkCommit') !== false) {
      return this.saveBulk(store, commitDetails);
    }
    var adapter = this;

    var rootNodes = this._createDependencyGraph(store, commitDetails);

    function createNestedPromise(node) {
      var promise;
      if(!adapter.shouldSave(node.record)) {
        // return an "identity" promise if we don't want to do anything
        promise = jQuery.Deferred().resolve();
      } else if(node.operation === "created") {
        promise = adapter.createRecord(store, node.record.constructor, node.record);
      } else if(node.operation === "updated") {
        promise = adapter.updateRecord(store, node.record.constructor, node.record);
      } else if(node.operation === "deleted") {
        promise = adapter.deleteRecord(store, node.record.constructor, node.record);
      }
      if(node.children.length > 0) {
        promise = promise.pipe(function() {
          var childPromises = node.children.map(createNestedPromise);
          return jQuery.when.apply(jQuery, childPromises);
        });
      }
      return promise;
    }

    return jQuery.when.apply(jQuery, rootNodes.map(createNestedPromise));
  },

  // slightly more complex algorithm that will be
  // less optimal if bulkCommit is not available
  saveBulk: function(store, commitDetails) {
    var adapter = this;

    var rootNodes = this._createDependencyGraph(store, commitDetails);

    function createNestedPromises(nodes) {

      // 2d partition on operation and type
      var map = Ember.MapWithDefault.create({
        defaultValue: function() {
          return Ember.MapWithDefault.create({
            defaultValue: function() {
              return Ember.OrderedSet.create();
            }
          });
        }
      });

      nodes.forEach(function(node) {
        var operation = adapter.shouldSave(node.record) ? node.operation : 'skipped';
        map.get(operation).get(node.record.constructor).add(node);
      });

      function flatten(arr) {
        return arr.reduce(function(a, b) {
          return a.concat(b);
        }, []);
      }

      var promises = map.keys.toArray().map(function(operation) {
        var typeMap = map.get(operation);
        return typeMap.keys.toArray().map(function(type) {
          var nodes = typeMap.get(type);
          var records = Ember.OrderedSet.create();
          nodes.forEach(function(node) { records.add(node.record); });
          var promise = null;
          if (nodes.isEmpty() || operation === "skipped") {
            promise = jQuery.Deferred().resolve();
          } else if (operation === "deleted") {
            promise = adapter.deleteRecords(store, type, records);
          } else if (operation === "created") {
            promise = adapter.createRecords(store, type, records);
          } else if (operation === "updated") {
            promise = adapter.updateRecords(store, type, records);
          }
          return promise.pipe(function() {
            var children = Ember.A(nodes.toArray()).map(function(node) { return node.children.toArray(); });
            return createNestedPromises(flatten(children));
          });
        });
      });

      return jQuery.when.apply(jQuery, flatten(promises));
    }

    return createNestedPromises(rootNodes);
  },

  _createDependencyGraph: function(store, commitDetails) {
    var adapter = this;
    var clientIdToNode = Ember.MapWithDefault.create({
      defaultValue: function(clientId) {
        var record = store.recordCache[clientId];
        var operation = null;
        if(commitDetails.deleted.has(record)) {
          operation = "deleted";
        } else if(commitDetails.created.has(record)) {
          operation = "created";
        } else if(commitDetails.updated.has(record)) {
          operation = "updated";
        }
        var node = new Node(record, operation);
        return node;
      }
    });

    commitDetails.relationships.forEach(function(r) {
      var childClientId = r.childReference.clientId;
      var parentClientId = r.parentReference.clientId;

      var childNode = clientIdToNode.get(childClientId);
      var parentNode = clientIdToNode.get(parentClientId);

      // in non-embedded case, child delete requests should
      // come before the parent request
      if(r.changeType === 'remove' && adapter.shouldSave(childNode.record)) {
        childNode.addChild(parentNode);
      } else {
        parentNode.addChild(childNode);
      }
    });

    var rootNodes = Ember.Set.create();
    function filter(record) {
      var node = clientIdToNode.get(get(record, 'clientId'));
      if(!get(node, 'parent.record.isDirty')) {
        rootNodes.add(node);
      }
    }

    commitDetails.created.forEach(filter);
    commitDetails.updated.forEach(filter);
    commitDetails.deleted.forEach(filter);

    return rootNodes;
  },

  shouldSave: function(record) {
    var reference = get(record, '_reference');

    return !reference.parent;
  },

  createRecord: function(store, type, record) {
    var root = this.rootForType(type);

    var data = {};
    data[root] = this.serialize(record, { includeId: true });

    return this.ajax(this.buildURL(root), "POST", {
      data: data,
      context: this,
      success: function(json) {
        Ember.run(this, function(){
          this.didCreateRecord(store, type, record, json);
        });
      },
      error: function(xhr) {
        this.didError(store, type, record, xhr);
      }
    });
  },

  dirtyRecordsForRecordChange: function(dirtySet, record) {
    this._dirtyTree(dirtySet, record);
  },

  dirtyRecordsForHasManyChange: function(dirtySet, record, relationship) {
    var embeddedType = get(this, 'serializer').embeddedType(record.constructor, relationship.secondRecordName);

    if (embeddedType === 'always') {
      relationship.childReference.parent = relationship.parentReference;
      this._dirtyTree(dirtySet, record);
    }
  },

  _dirtyTree: function(dirtySet, record) {
    dirtySet.add(record);

    get(this, 'serializer').eachEmbeddedRecord(record, function(embeddedRecord, embeddedType) {
      if (embeddedType !== 'always') { return; }
      if (dirtySet.has(embeddedRecord)) { return; }
      this._dirtyTree(dirtySet, embeddedRecord);
    }, this);

    var reference = record.get('_reference');

    if (reference.parent) {
      var store = get(record, 'store');
      var parent = store.recordForReference(reference.parent);
      this._dirtyTree(dirtySet, parent);
    }
  },

  createRecords: function(store, type, records) {
    if (get(this, 'bulkCommit') === false) {
      return jQuery.when.apply(jQuery, records.map(function(record) {
        return this.createRecord(store, type, record);
      }, this));
    }

    var root = this.rootForType(type),
        plural = this.pluralize(root);

    var data = {};
    data[plural] = [];
    records.forEach(function(record) {
      data[plural].push(this.serialize(record, { includeId: true }));
    }, this);

    return this.ajax(this.buildURL(root), "POST", {
      data: data,
      context: this,
      success: function(json) {
        Ember.run(this, function(){
          this.didCreateRecords(store, type, records, json);
        });
      }
    });
  },

  updateRecord: function(store, type, record) {
    var id = get(record, 'id');
    var root = this.rootForType(type);

    var data = {};
    data[root] = this.serialize(record);

    return this.ajax(this.buildURL(root, id), "PUT", {
      data: data,
      context: this,
      success: function(json) {
        Ember.run(this, function(){
          this.didSaveRecord(store, type, record, json);
        });
      },
      error: function(xhr) {
        this.didError(store, type, record, xhr);
      }
    });
  },

  updateRecords: function(store, type, records) {
    if (get(this, 'bulkCommit') === false) {
      return jQuery.when.apply(jQuery, records.map(function(record) {
        return this.updateRecord(store, type, record);
      }, this));
    }

    var root = this.rootForType(type),
        plural = this.pluralize(root);

    var data = {};
    data[plural] = [];
    records.forEach(function(record) {
      data[plural].push(this.serialize(record, { includeId: true }));
    }, this);

    return this.ajax(this.buildURL(root, "bulk"), "PUT", {
      data: data,
      context: this,
      success: function(json) {
        Ember.run(this, function(){
          this.didSaveRecords(store, type, records, json);
        });
      }
    });
  },

  deleteRecord: function(store, type, record) {
    var id = get(record, 'id');
    var root = this.rootForType(type);

    return this.ajax(this.buildURL(root, id), "DELETE", {
      context: this,
      success: function(json) {
        Ember.run(this, function(){
          this.didSaveRecord(store, type, record, json);
        });
      }
    });
  },

  deleteRecords: function(store, type, records) {
    if (get(this, 'bulkCommit') === false) {
      return jQuery.when.apply(jQuery, records.map(function(record) {
        return this.deleteRecord(store, type, record);
      }, this));
    }

    var root = this.rootForType(type),
        plural = this.pluralize(root),
        serializer = get(this, 'serializer');

    var data = {};
    data[plural] = [];
    records.forEach(function(record) {
      data[plural].push(serializer.serializeId( get(record, 'id') ));
    });

    return this.ajax(this.buildURL(root, 'bulk'), "DELETE", {
      data: data,
      context: this,
      success: function(json) {
        Ember.run(this, function(){
          this.didSaveRecords(store, type, records, json);
        });
      }
    });
  },

  find: function(store, type, id) {
    var root = this.rootForType(type);

    return this.ajax(this.buildURL(root, id), "GET", {
      success: function(json) {
        Ember.run(this, function(){
          this.didFindRecord(store, type, json, id);
        });
      }
    });
  },

  findAll: function(store, type, since) {
    var root = this.rootForType(type);

    return this.ajax(this.buildURL(root), "GET", {
      data: this.sinceQuery(since),
      success: function(json) {
        Ember.run(this, function(){
          this.didFindAll(store, type, json);
        });
      }
    });
  },

  findQuery: function(store, type, query, recordArray) {
    var root = this.rootForType(type);

    return this.ajax(this.buildURL(root), "GET", {
      data: query,
      success: function(json) {
        Ember.run(this, function(){
          this.didFindQuery(store, type, json, recordArray);
        });
      }
    });
  },

  findMany: function(store, type, ids, owner) {
    var root = this.rootForType(type);
    ids = this.serializeIds(ids);

    return this.ajax(this.buildURL(root), "GET", {
      data: {ids: ids},
      success: function(json) {
        Ember.run(this, function(){
          this.didFindMany(store, type, json);
        });
      }
    });
  },

  /**
    @private

    This method serializes a list of IDs using `serializeId`

    @returns {Array} an array of serialized IDs
  */
  serializeIds: function(ids) {
    var serializer = get(this, 'serializer');

    return Ember.EnumerableUtils.map(ids, function(id) {
      return serializer.serializeId(id);
    });
  },

  didError: function(store, type, record, xhr) {
    if (xhr.status === 422) {
      var data = JSON.parse(xhr.responseText);
      store.recordWasInvalid(record, data['errors']);
    } else {
      this._super.apply(this, arguments);
    }
  },

  ajax: function(url, type, hash) {
    hash.url = url;
    hash.type = type;
    hash.dataType = 'json';
    hash.contentType = 'application/json; charset=utf-8';
    hash.context = this;

    if (hash.data && type !== 'GET') {
      hash.data = JSON.stringify(hash.data);
    }

    return jQuery.ajax(hash);
  },

  url: "",

  rootForType: function(type) {
    var serializer = get(this, 'serializer');
    return serializer.rootForType(type);
  },

  pluralize: function(string) {
    var serializer = get(this, 'serializer');
    return serializer.pluralize(string);
  },

  buildURL: function(record, suffix) {
    var url = [this.url];

    Ember.assert("Namespace URL (" + this.namespace + ") must not start with slash", !this.namespace || this.namespace.toString().charAt(0) !== "/");
    Ember.assert("Record URL (" + record + ") must not start with slash", !record || record.toString().charAt(0) !== "/");
    Ember.assert("URL suffix (" + suffix + ") must not start with slash", !suffix || suffix.toString().charAt(0) !== "/");

    if (this.namespace !== undefined) {
      url.push(this.namespace);
    }

    url.push(this.pluralize(record));
    if (suffix !== undefined) {
      url.push(suffix);
    }

    return url.join("/");
  },

  sinceQuery: function(since) {
    var query = {};
    query[get(this, 'since')] = since;
    return since ? query : null;
  }
});

