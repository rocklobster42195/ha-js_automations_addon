/**
 * JS Automations API Definitions
 * This file defines the global 'ha' object and other utilities available in scripts.
 */

// Placeholder for dynamic EntityID type (will be overridden by editor-config.js with real entities)
type EntityID = string;

// Placeholder for dynamic ServiceMap (will be overridden by editor-config.js with real services)
type ServiceMap = Record<string, Record<string, any>>;

type ChangeFilter = "ne" | "any" | "eq" | "gt" | "ge" | "lt" | "le";

interface HAAttributes {
    friendly_name?: string;
    /** Alias for friendly_name */
    name?: string;
    unit_of_measurement?: string;
    /** Alias for unit_of_measurement */
    unit?: string;
    icon?: string;
    device_class?: string;
    state_class?: 'measurement' | 'total' | 'total_increasing';
    entity_picture?: string;
    last_updated_by?: string;
    [key: string]: any;
}

interface HAState<T = HAAttributes> {
    entity_id: string;
    state: string;
    attributes: T;
    last_changed: string;
    last_updated: string;
    context: any;
}

interface EntitySelector<T = HAAttributes> {
    /** Returns the number of entities in the current selection */
    count: number;
    /** Executes a function for each entity in the selection */
    each(callback: (entity: HAState<T>) => void): EntitySelector<T>;
    /** Maps the selection to a new array of values. */
    map<R>(callback: (entity: HAState<T>) => R): R[];
    /** Filters the current selection */
    where(callback: (entity: HAState<T>) => boolean): EntitySelector<T>;
    /** Calls a service for all entities in the selection */
    call(service: string, data?: any): EntitySelector<T>;
    /** Shortcut to turn all selected entities ON */
    turnOn(data?: any): EntitySelector<T>;
    /** Shortcut to turn all selected entities OFF */
    turnOff(data?: any): EntitySelector<T>;
    /** Expands groups in the selection to their individual members. */
    expand(): EntitySelector<T>;
    /** Returns the raw array of state objects */
    toArray(): HAState<T>[];
}

interface HA {
    /** Logs a message with level INFO. */
    log(message: any): void;
    /** Logs a message with level DEBUG. */
    debug(message: any): void;
    /** Logs a message with level WARN. */
    warn(message: any): void;
    /** Logs a message with level ERROR. */
    error(message: any): void;

    /**
     * Stops the execution of the current script.
     * The script will not run again until manually started or triggered by an external event.
     * @param reason Optional reason for stopping, which will be logged. Defaults to 'stopped by script'.
     */
    stop(reason?: string): void;

    /**
     * Immediately stops and restarts the current script.
     * Useful for self-healing logic to recover from a faulty state.
     * @param reason Optional reason for restarting, which will be logged. Defaults to 'restarted by script'.
     */
    restart(reason?: string): void;

    /**
     * Calls a Home Assistant service.
     * @param domain The domain (e.g., 'light', 'switch')
     * @param service The service name (e.g., 'turn_on')
     * @param data Service data (e.g., { entity_id: '...' })
     */
    callService<D extends keyof ServiceMap, S extends keyof ServiceMap[D]>(domain: D, service: S, data?: ServiceMap[D][S]): void;

    /** Updates the attributes of an entity without changing its state. */
    update(entityId: EntityID, attributes: HAAttributes): void;
    
    /** Updates the state and attributes of an entity. */
    update(entityId: EntityID, state: any, attributes?: HAAttributes): void;

    /**
     * Registers a native Home Assistant entity via the integration.
     * @param entityId The entity ID (e.g. 'sensor.my_sensor')
     * @param config Configuration object
     */
    register(entityId: EntityID, config: {
        name?: string;
        friendly_name?: string;
        icon?: string;
        area?: string;
        labels?: string[] | string;
        initial_state?: any;
        unit_of_measurement?: string;
        unit?: string;
        device_class?: string;
        state_class?: string;
        entity_picture?: string;
        [key: string]: any;
    }): void;

    /** Global persistent store. */
    store: {
        /** Direct access to the local cache of the store. */
        val: Record<string, any>;
        /** Sets a value in the store. */
        set(key: string, value: any, isSecret?: boolean): void;
        /** Gets a value from the store. */
        get<T = any>(key: string): T;
        /** Deletes a value from the store. */
        delete(key: string): void;
        /** Subscribes to changes of a specific store key. */
        on(key: string, callback: (newValue: any, oldValue: any) => void): void;
    };

    /**
     * Creates a "magic" persistent object that automatically saves changes.
     * Under the hood, it uses a JS Proxy to intercept assignments and calls `ha.store.set()`.
     * @param key The key to use in the global store.
     * @param defaultValue The default object to create if the key doesn't exist.
     * @returns A proxied object that you can modify directly.
     */
    persistent<T extends object>(key: string, defaultValue: T): T;

    /** Real-time cache of all Home Assistant states. */
    states: Record<EntityID, HAState>;

    /** Gets the state of a specific entity with typed attributes. */
    getState<T = HAAttributes>(entityId: EntityID): HAState<T>;

    /** Gets a specific attribute of an entity. */
    getAttr<T = any>(entityId: EntityID, attr: string): T;

    /** Gets the state of an entity, automatically converted to number/boolean if possible. */
    getStateValue<T = string | number | boolean>(entityId: EntityID): T;

    /** Returns the members of a group as an array of entity IDs. */
    getGroupMembers(entityId: EntityID): string[];

    /**
     * Reads a value from the script header (JSDoc tags).
     * @param key The tag name (e.g. 'name', 'icon', 'area')
     * @param defaultValue Value to return if tag is missing
     */
    getHeader<T = string>(key: string, defaultValue?: T): T | undefined;

    /**
     * Subscribes to state changes.
     * @param pattern Entity ID, array of IDs, wildcard string, or RegExp
     * @param callback Function called when state changes
     */
    on<T = HAAttributes>(pattern: EntityID | string | string[] | RegExp, callback: (event: {
        entity_id: string;
        state: string;
        old_state?: string;
        attributes: T;
    }) => void): void;

    /**
     * Subscribes to state changes with a filter condition.
     * @param pattern Entity ID or pattern
     * @param filter Condition (e.g. 'gt' for greater than old value)
     */
    on<T = HAAttributes>(pattern: EntityID | string | string[] | RegExp, filter: ChangeFilter, callback: (event: { entity_id: string; state: string; old_state?: string; attributes: T; }) => void): void;

    /**
     * Subscribes to state changes with a threshold condition.
     * @param pattern Entity ID or pattern
     * @param filter Condition (e.g. 'gt' for greater than threshold)
     * @param threshold The value to compare against
     */
    on<T = HAAttributes>(pattern: EntityID | string | string[] | RegExp, filter: ChangeFilter, threshold: number | string, callback: (event: { entity_id: string; state: string; old_state?: string; attributes: T; }) => void): void;

    /**
     * Waits for a state change.
     * @param pattern Entity ID or pattern
     * @param options Timeout settings (default: 5000ms)
     */
    waitFor<T = HAAttributes>(pattern: EntityID | string | string[] | RegExp, options?: { timeout?: number }): Promise<{ entity_id: string; state: string; old_state?: string; attributes: T; }>;

    /**
     * Waits for a state change with a filter.
     * @param pattern Entity ID or pattern
     * @param filter Condition (e.g. 'eq', 'gt')
     * @param options Timeout settings (default: 5000ms)
     */
    waitFor<T = HAAttributes>(pattern: EntityID | string | string[] | RegExp, filter: ChangeFilter, options?: { timeout?: number }): Promise<{ entity_id: string; state: string; old_state?: string; attributes: T; }>;

    /**
     * Waits for a state change with a filter and threshold.
     * @param pattern Entity ID or pattern
     * @param filter Condition (e.g. 'eq', 'gt')
     * @param threshold Value to compare against
     * @param options Timeout settings (default: 5000ms)
     */
    waitFor<T = HAAttributes>(pattern: EntityID | string | string[] | RegExp, filter: ChangeFilter, threshold: number | string, options?: { timeout?: number }): Promise<{ entity_id: string; state: string; old_state?: string; attributes: T; }>;

    /**
     * Pauses script execution until a condition function returns true.
     * This is useful for waiting on complex states involving multiple entities.
     * @param condition A function that returns true when the wait should end.
     * @param options Timeout settings. `timeout` is the maximum total wait time (default 30s).
     * `pollInterval` is the maximum time between condition checks (default 5s).
     */
    waitUntil(condition: () => boolean, options?: { timeout?: number, pollInterval?: number }): Promise<void>;

    /** Registers a callback to run when the script stops. */
    onStop(callback: () => void): void;

    /** Registers a global error handler for the script. */
    onError(callback: (error: { message: string, stack?: string, type: string }) => void): void;

    /** Selects multiple entities for bulk operations. */
    select<T = HAAttributes>(pattern: string | RegExp): EntitySelector<T>;
}

declare var ha: HA;
declare var axios: any;
declare function schedule(cron: string, callback: () => void): void;
declare function sleep(ms: number): Promise<void>;