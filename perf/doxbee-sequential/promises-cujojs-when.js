var when = require('when'),
    p = require('../lib/promiseSupport.js');

require('../lib/fakesP');

module.exports = function upload(stream, idOrPath, tag, done) {
    var blob = blobManager.create(account);
    var tx = db.begin();
    var blobIdP = blob.put(stream);
    var fileP = self.byUuidOrPath(idOrPath).get();
    var version, fileId, file;
    when.try(function(blobId, fileV) {
    // when.all([blobIdP, fileP]).then(function(a) {
      // var blobId = a[0], fileV = a[1];
        file = fileV;
        var previousId = file ? file.version : null;
        version = {
            userAccountId: userAccount.id,
            date: new Date(),
            blobId: blobId,
            creatorId: userAccount.id,
            previousId: previousId,
        };
        version.id = Version.createHash(version);
        return Version.insert(version).execWithin(tx);
    }, blobIdP, fileP).then(function() {
    // }).then(function() {
        if (!file) {
            var splitPath = idOrPath.split('/');
            var fileName = splitPath[splitPath.length - 1];
            var newId = uuid.v1();
            return self.createQuery(idOrPath, {
                id: newId,
                userAccountId: userAccount.id,
                name: fileName,
                version: version.id
            }).then(function(q) {
                return q.execWithin(tx);
            }).then(function() {
                return newId;
            });
        } else {
            return file.id;
        }
    }).then(function(fileIdV) {
        fileId = fileIdV;
        return FileVersion.insert({
            fileId: fileId,
            versionId: version.id
        }).execWithin(tx);
    }).then(function() {
        return File.whereUpdate({id: fileId}, {version: version.id})
            .execWithin(tx);
    }).then(function() {
        tx.commit();
        return done();
    }, function(err) {
        tx.rollback();
        return done(err);
    });
}