class Plugins {
  #plugins = {};

  get db() {
    const { db } = this.#plugins;

    if (!db) {
      throw new NotRegisteredError('database');
    }

    return db;
  }

  use(plugin, options) {
    if (plugin == null) {
      throw new Error('Plugin is required');
    }

    if (!plugin.ODDJOB_PLUGIN_TYPE) {
      throw new Error('Plugin must export ODDJOB_PLUGIN_TYPE');
    }

    if (plugin.init) {
      plugin.init(options);
    }

    this.#plugins[plugin.ODDJOB_PLUGIN_TYPE] = plugin;
  }
}

class NotRegisteredError extends Error {
  constructor(typeName) {
    super(
      `No ${typeName} plugin is registered. Use oddjob.use(plugin, options) to register a ${typeName} plugin.`
    );
  }
}

const plugins = new Plugins();

module.exports = plugins;
