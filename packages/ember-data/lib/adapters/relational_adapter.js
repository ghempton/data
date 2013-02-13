require('ember-data/adapters/rest_adapter');
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
  },
  promise: function(store, adapter) {
    if(!adapter.shouldSave(this.record)) {
      // return an "identity" promise if we don't want to do anything
      return jQuery.Deferred().resolve();
    } else if(this.operation === "created") {
      return adapter.createRecord(store, this.record.constructor, this.record);
    } else if(this.operation === "updated") {
      return adapter.updateRecord(store, this.record.constructor, this.record);
    } else if(this.operation === "deleted") {
      return adapter.deleteRecord(store, this.record.constructor, this.record);
    }
  }
};

DS.RelationalAdapter = DS.RESTAdapter.extend({

  save: function(store, commitDetails) {
    var adapter = this;

    var rootNodes = this._createDependencyGraph(store, commitDetails);

    function createNestedPromise(node) {
      var promise = node.promise(store, adapter);
      if(node.children.length > 0) {
        promise = promise.pipe(function() {
          var childPromises = node.children.map(createNestedPromise);
          return jQuery.when.apply(jQuery, childPromises);
        });
      }
      return promise;
    }

    return rootNodes.map(createNestedPromise);
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
  }

});